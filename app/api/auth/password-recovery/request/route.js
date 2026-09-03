import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { getRequestId, securityLog } from "@/lib/security-log";
import {
  ACCOUNT_RECOVERY_MESSAGE,
  accountAllowsPasswordRecovery,
  createAccountRecoveryToken,
  normalizeRecoveryEmail,
  passwordRecoveryOrganisationId,
  resolveRecoveryOrigin
} from "@/lib/account-recovery.mjs";
import { sendAccountRecoveryEmail } from "@/lib/account-recovery-email-service";

export const dynamic = "force-dynamic";

const REQUEST_LIMIT = 3;
const REQUEST_WINDOW_MS = 15 * 60 * 1_000;
const MINIMUM_RESPONSE_MS = 700;

function reply(payload, status = 200, headers = {}) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...headers
    }
  });
}

async function waitForMinimum(startedAt) {
  const remaining = MINIMUM_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export async function POST(request) {
  const startedAt = Date.now();
  let email = "";
  try {
    const body = await request.json();
    try {
      email = normalizeRecoveryEmail(body.email);
    } catch (error) {
      return reply({ error: error.message }, 400);
    }

    const rateLimit = await consumeRateLimit({
      key: createRateLimitKey("account-recovery-request", request, email),
      limit: REQUEST_LIMIT,
      windowMs: REQUEST_WINDOW_MS
    });
    if (!rateLimit.allowed) {
      securityLog("warn", "ACCOUNT_RECOVERY_RATE_LIMITED", request);
      await waitForMinimum(startedAt);
      return reply(
        { error: "Too many recovery requests. Please wait before trying again." },
        429,
        { "Retry-After": String(rateLimit.retryAfterSeconds) }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          select: {
            organisationId: true,
            organisation: { select: { enterpriseSecurityPolicy: true } }
          }
        }
      }
    });

    if (accountAllowsPasswordRecovery(user)) {
      const generated = createAccountRecoveryToken();
      const organisationId = passwordRecoveryOrganisationId(user);
      const saved = await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() }
        });
        const token = await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: generated.tokenHash,
            expiresAt: generated.expiresAt
          }
        });
        await tx.auditLog.create({
          data: {
            organisationId,
            actorUserId: user.id,
            action: "ACCOUNT_RECOVERY_REQUESTED",
            entityType: "PasswordResetToken",
            entityId: token.id,
            details: { expiresAt: generated.expiresAt, requestId: getRequestId(request) }
          }
        });
        return token;
      });

      try {
        const origin = resolveRecoveryOrigin(request.url);
        const delivery = await sendAccountRecoveryEmail({
          recovery: {
            recipientEmail: user.email,
            resetUrl: `${origin}/reset-password#token=${generated.token}`,
            tokenId: saved.id,
            expiresAt: generated.expiresAt
          }
        });
        if (!delivery.configured) {
          await prisma.passwordResetToken.updateMany({
            where: { id: saved.id, usedAt: null },
            data: { usedAt: new Date() }
          });
          securityLog("error", "ACCOUNT_RECOVERY_EMAIL_UNAVAILABLE", request, { userId: user.id });
        }
      } catch (error) {
        securityLog("error", "ACCOUNT_RECOVERY_EMAIL_FAILED", request, {
          userId: user.id,
          errorCode: String(error?.code || "DELIVERY_FAILED").slice(0, 80)
        });
      }
    } else {
      // Match the cryptographic work performed for an eligible account without
      // revealing whether the address exists or is managed through company SSO.
      createAccountRecoveryToken();
    }

    await waitForMinimum(startedAt);
    securityLog("info", "ACCOUNT_RECOVERY_REQUEST_ACCEPTED", request);
    return reply({ ok: true, message: ACCOUNT_RECOVERY_MESSAGE });
  } catch (error) {
    securityLog("error", "ACCOUNT_RECOVERY_REQUEST_ERROR", request, {
      errorCode: String(error?.code || "REQUEST_FAILED").slice(0, 80)
    });
    await waitForMinimum(startedAt);
    return reply({ ok: true, message: ACCOUNT_RECOVERY_MESSAGE });
  }
}
