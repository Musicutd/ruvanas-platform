import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { activeMembershipAllowedForSession, findSessionFallbackMembership, selectActiveMembership } from "./active-organisation.mjs";
import { enterpriseSessionIsUsable } from "./enterprise-security.mjs";

const SESSION_COOKIE = "ruvanas_session";
const SESSION_TTL_DAYS = 30;

function getSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }

  return secret;
}

function hashToken(token) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(token)
    .digest("hex");
}

export async function createSession(userId, preferredOrganisationId = null) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  const membership = preferredOrganisationId
    ? await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId,
            organisationId: preferredOrganisationId
          }
        }
      })
    : await prisma.organisationMember.findFirst({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });

  await prisma.session.create({
    data: {
      userId,
      activeOrganisationId: membership?.organisationId || null,
      tokenHash,
      expiresAt
    }
  });

  cookies().set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/"
  });
}

async function refreshSessionActivity(session, now = new Date()) {
  if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    session.lastSeenAt = now;
  }
}

export async function getCurrentSession({ refreshActivity = true } = {}) {
  const rawToken = cookies().get(SESSION_COOKIE)?.value;

  if (!rawToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: hashToken(rawToken)
    },
    include: {
      user: true,
      activeOrganisation: {
        include: { enterpriseSecurityPolicy: true }
      }
    }
  });

  const now = new Date();
  const policy = session?.activeOrganisation?.enterpriseSecurityPolicy;
  if (!enterpriseSessionIsUsable(session, policy, now)) {
    return null;
  }

  if (refreshActivity) {
    // getCurrentUser and other direct session callers may not load an
    // organisation context. If the selected membership has disappeared,
    // enforce the deterministic fallback's policy before access or activity
    // refresh. Ordinary sessions add one membership lookup on this path.
    const fallback = await findSessionFallbackMembership(prisma, session);
    if (fallback && !activeMembershipAllowedForSession(fallback, session, now)) return null;
    await refreshSessionActivity(session, now);
  }

  return session;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user || null;
}

export async function getActiveOrganisationContext(organisationInclude = {}) {
  // Preserve the original lastSeenAt until the selected membership's policy
  // is checked; otherwise a stricter fallback idle limit could be bypassed.
  const session = await getCurrentSession({ refreshActivity: false });

  if (!session) {
    return null;
  }

  const memberships = await prisma.organisationMember.findMany({
    where: { userId: session.userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      organisation: {
        include: { ...organisationInclude, enterpriseSecurityPolicy: true }
      }
    }
  });
  const membership = selectActiveMembership(
    memberships,
    session.activeOrganisationId
  );

  // Selection can fall back after a membership is removed. Recheck against
  // the policy of the organisation that will actually be used.
  if (membership && !activeMembershipAllowedForSession(membership, session)) {
    return null;
  }

  await refreshSessionActivity(session);

  return { session, user: session.user, membership, memberships };
}

export async function setActiveOrganisation(organisationId) {
  const session = await getCurrentSession({ refreshActivity: false });

  if (!session) {
    return { ok: false, status: 401, error: "Your session has expired." };
  }

  const membership = await prisma.organisationMember.findUnique({
    where: {
      userId_organisationId: {
        userId: session.userId,
        organisationId
      }
    },
    include: { organisation: { include: { enterpriseSecurityPolicy: true } } }
  });

  if (!membership) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to this organisation."
    };
  }

  if (!activeMembershipAllowedForSession(membership, session)) {
    return { ok: false, status: 403, error: "Sign in again to meet this organisation's security policy." };
  }

  const now = new Date();
  const refreshActivity = now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000;

  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { activeOrganisationId: organisationId, ...(refreshActivity ? { lastSeenAt: now } : {}) }
    }),
    prisma.auditLog.create({
      data: {
        organisationId,
        actorUserId: session.userId,
        action: "ACTIVE_ORGANISATION_CHANGED",
        entityType: "Organisation",
        entityId: organisationId
      }
    })
  ]);

  if (refreshActivity) session.lastSeenAt = now;

  return { ok: true, session, membership };
}

export async function destroySession() {
  const rawToken = cookies().get(SESSION_COOKIE)?.value;

  if (rawToken) {
    await prisma.session.deleteMany({
      where: {
        tokenHash: hashToken(rawToken)
      }
    });
  }

  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/"
  });
}

