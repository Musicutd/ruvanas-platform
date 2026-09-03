import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { getRequestId, securityLog } from "@/lib/security-log";
import {
  accountAllowsPasswordRecovery,
  hashAccountRecoveryToken,
  passwordRecoveryOrganisationId,
  validateRecoveryPassword
} from "@/lib/account-recovery.mjs";

export const dynamic = "force-dynamic";

function reply(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const validation = validateRecoveryPassword(body);
    if (!validation.ok) return reply({ error: validation.error }, 400);

    let tokenHash;
    try {
      tokenHash = hashAccountRecoveryToken(body.token);
    } catch {
      return reply({ error: "This recovery link is invalid or has expired. Request a new link." }, 410);
    }

    const rateLimit = await consumeRateLimit({
      key: createRateLimitKey("account-recovery-reset", request, tokenHash),
      limit: 8,
      windowMs: 30 * 60 * 1_000
    });
    if (!rateLimit.allowed) {
      securityLog("warn", "ACCOUNT_RECOVERY_RESET_RATE_LIMITED", request);
      return reply({ error: "Too many reset attempts. Request a new recovery link." }, 429);
    }

    const now = new Date();
    const recovery = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            memberships: {
              select: {
                organisationId: true,
                organisation: { select: { enterpriseSecurityPolicy: true } }
              }
            }
          }
        }
      }
    });
    if (!recovery || recovery.usedAt || recovery.expiresAt <= now || !accountAllowsPasswordRecovery(recovery.user)) {
      return reply({ error: "This recovery link is invalid or has expired. Request a new link." }, 410);
    }
    if (await bcrypt.compare(validation.password, recovery.user.passwordHash)) {
      return reply({ error: "Choose a password that is different from your current password." }, 400);
    }

    const passwordHash = await bcrypt.hash(validation.password, 12);
    const organisationId = passwordRecoveryOrganisationId(recovery.user);
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: recovery.id, tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (claimed.count !== 1) return null;
      await tx.user.update({ where: { id: recovery.userId }, data: { passwordHash } });
      const revoked = await tx.session.updateMany({
        where: { userId: recovery.userId, revokedAt: null },
        data: { revokedAt: now }
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: recovery.userId, id: { not: recovery.id }, usedAt: null },
        data: { usedAt: now }
      });
      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: recovery.userId,
          action: "ACCOUNT_RECOVERY_COMPLETED",
          entityType: "User",
          entityId: recovery.userId,
          details: { sessionsRevoked: revoked.count, requestId: getRequestId(request) }
        }
      });
      return { revokedSessions: revoked.count };
    });

    if (!result) return reply({ error: "This recovery link is invalid or has expired. Request a new link." }, 410);
    securityLog("info", "ACCOUNT_RECOVERY_COMPLETED", request, {
      userId: recovery.userId,
      revokedSessions: result.revokedSessions
    });
    return reply({
      ok: true,
      message: "Your password has been reset and all previous sessions have been signed out.",
      destination: "/login?password-reset=1"
    });
  } catch (error) {
    securityLog("error", "ACCOUNT_RECOVERY_RESET_ERROR", request, {
      errorCode: String(error?.code || "RESET_FAILED").slice(0, 80)
    });
    return reply({ error: "Unable to reset the password. Please request a new recovery link." }, 500);
  }
}
