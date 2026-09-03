import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";
import {
  canRevokeSubscriberSession,
  normalizeSubscriberProfileName,
  subscriberPasswordChangeAllowed,
  subscriberSessionSummary,
  validateSubscriberPasswordChange
} from "@/lib/subscriber-profile-security.mjs";

export const dynamic = "force-dynamic";

function response(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" }
  });
}

async function access() {
  const context = await getActiveOrganisationContext({ enterpriseSecurityPolicy: true });
  if (!context) return { denied: response({ error: "Sign in to manage your profile." }, 401) };
  if (!context.membership) return { denied: response({ error: "Select an organisation first." }, 403) };
  if (context.user.role === "STUDENT") return { denied: response({ error: "Student profiles are managed through the supervised school workspace." }, 403) };
  return { context };
}

export async function GET() {
  try {
    const result = await access();
    if (result.denied) return result.denied;
    const { context } = result;
    const now = new Date();
    const sessions = await prisma.session.findMany({
      where: {
        userId: context.user.id,
        revokedAt: null,
        expiresAt: { gt: now }
      },
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        authMethod: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        activeOrganisation: { select: { name: true } }
      }
    });

    return response({
      profile: {
        name: context.user.name || "",
        email: context.user.email,
        role: context.membership.role
      },
      passwordChangeAllowed: subscriberPasswordChangeAllowed(context.membership.organisation.enterpriseSecurityPolicy),
      sessions: sessions.map((session) => subscriberSessionSummary(session, context.session.id, now))
    });
  } catch (error) {
    console.error("Load subscriber profile security error:", error);
    return response({ error: "Unable to load your profile and sessions." }, 500);
  }
}

export async function PATCH(request) {
  try {
    const result = await access();
    if (result.denied) return result.denied;
    const { context } = result;
    const body = await request.json();
    const action = String(body.action || "").toUpperCase();
    const rateLimit = await consumeRateLimit({
      key: createRateLimitKey("subscriber-profile-security", request, context.user.id),
      limit: action === "PASSWORD" ? 5 : 15,
      windowMs: action === "PASSWORD" ? 15 * 60 * 1000 : 60 * 60 * 1000
    });
    if (!rateLimit.allowed) {
      return response(
        { error: "Too many security changes. Please wait before trying again." },
        429
      );
    }

    if (action === "PROFILE") {
      let name;
      try {
        name = normalizeSubscriberProfileName(body.name);
      } catch (validationError) {
        return response({ error: validationError.message }, 400);
      }
      await prisma.$transaction([
        prisma.user.update({ where: { id: context.user.id }, data: { name } }),
        prisma.auditLog.create({
          data: {
            organisationId: context.membership.organisationId,
            actorUserId: context.user.id,
            action: "SUBSCRIBER_PROFILE_UPDATED",
            entityType: "User",
            entityId: context.user.id,
            details: { fields: ["name"] }
          }
        })
      ]);
      return response({ ok: true, profile: { name, email: context.user.email } });
    }

    if (action === "PASSWORD") {
      const policy = context.membership.organisation.enterpriseSecurityPolicy;
      if (!subscriberPasswordChangeAllowed(policy)) {
        return response({ error: "Password changes are disabled because this organisation requires company sign-in." }, 403);
      }
      const validation = validateSubscriberPasswordChange(body);
      if (!validation.ok) return response({ error: validation.error }, 400);
      const matches = await bcrypt.compare(validation.currentPassword, context.user.passwordHash);
      if (!matches) {
        securityLog("warn", "SUBSCRIBER_PASSWORD_CHANGE_FAILED", request, { userId: context.user.id });
        return response({ error: "Your current password is incorrect." }, 401);
      }

      const now = new Date();
      const passwordHash = await bcrypt.hash(validation.newPassword, 12);
      const [, revoked] = await prisma.$transaction([
        prisma.user.update({ where: { id: context.user.id }, data: { passwordHash } }),
        prisma.session.updateMany({
          where: { userId: context.user.id, id: { not: context.session.id }, revokedAt: null },
          data: { revokedAt: now }
        }),
        prisma.auditLog.create({
          data: {
            organisationId: context.membership.organisationId,
            actorUserId: context.user.id,
            action: "SUBSCRIBER_PASSWORD_CHANGED",
            entityType: "User",
            entityId: context.user.id,
            details: { otherSessionsRevokedAt: now }
          }
        })
      ]);
      securityLog("info", "SUBSCRIBER_PASSWORD_CHANGED", request, { userId: context.user.id, revokedSessions: revoked.count });
      return response({ ok: true, revokedSessions: revoked.count });
    }

    return response({ error: "Choose a supported profile or security action." }, 400);
  } catch (error) {
    console.error("Update subscriber profile security error:", error);
    return response({ error: "Unable to save the profile or security change." }, 500);
  }
}

export async function DELETE(request) {
  try {
    const result = await access();
    if (result.denied) return result.denied;
    const { context } = result;
    const body = await request.json();
    const action = String(body.action || "SESSION").toUpperCase();
    const now = new Date();
    const rateLimit = await consumeRateLimit({
      key: createRateLimitKey("subscriber-session-revoke", request, context.user.id),
      limit: 20,
      windowMs: 60 * 60 * 1000
    });
    if (!rateLimit.allowed) {
      return response({ error: "Too many sign-out requests. Please wait before trying again." }, 429);
    }

    if (action === "OTHERS") {
      const revoked = await prisma.$transaction(async (tx) => {
        const update = await tx.session.updateMany({
          where: { userId: context.user.id, id: { not: context.session.id }, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now }
        });
        await tx.auditLog.create({
          data: {
            organisationId: context.membership.organisationId,
            actorUserId: context.user.id,
            action: "SUBSCRIBER_OTHER_SESSIONS_REVOKED",
            entityType: "Session",
            details: { count: update.count, revokedAt: now }
          }
        });
        return update;
      });
      return response({ ok: true, revokedSessions: revoked.count });
    }

    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId || sessionId === context.session.id) {
      return response({ error: "Choose another active session to sign out." }, 400);
    }
    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId: context.user.id, revokedAt: null, expiresAt: { gt: now } },
      select: {
        id: true,
        authMethod: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        activeOrganisation: { select: { name: true } }
      }
    });
    if (!session) return response({ error: "That session is no longer active." }, 404);
    const summary = subscriberSessionSummary(session, context.session.id, now);
    if (!canRevokeSubscriberSession(summary)) return response({ error: "That session cannot be signed out." }, 400);

    await prisma.$transaction([
      prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } }),
      prisma.auditLog.create({
        data: {
          organisationId: context.membership.organisationId,
          actorUserId: context.user.id,
          action: "SUBSCRIBER_SESSION_REVOKED",
          entityType: "Session",
          entityId: session.id,
          details: { revokedAt: now }
        }
      })
    ]);
    return response({ ok: true, revokedSessions: 1 });
  } catch (error) {
    console.error("Revoke subscriber session error:", error);
    return response({ error: "Unable to sign out that session." }, 500);
  }
}
