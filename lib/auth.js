import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { selectActiveMembership } from "./active-organisation.mjs";
import { getSessionFromToken, hashSessionToken, SESSION_COOKIE } from "./session-lookup.js";

const SESSION_TTL_DAYS = 30;

export async function createSession(userId, preferredOrganisationId = null) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);
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

  await setSessionCookie(rawToken, expiresAt);
}

// Used after a code-redemption transaction commits, never for pending codes.
export async function setSessionCookie(rawToken, expiresAt) {
  if (typeof rawToken !== "string" || !/^[a-f0-9]{64}$/.test(rawToken) ||
    !(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) {
    throw new Error("Invalid session cookie.");
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/"
  });
}

export async function getCurrentSession() {
  const rawToken = cookies().get(SESSION_COOKIE)?.value;
  return getSessionFromToken(rawToken, { db: prisma });
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user || null;
}

export async function getActiveOrganisationContext(organisationInclude = {}) {
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  const memberships = await prisma.organisationMember.findMany({
    where: { userId: session.userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      organisation: {
        include: organisationInclude
      }
    }
  });
  const membership = selectActiveMembership(
    memberships,
    session.activeOrganisationId
  );

  return { session, user: session.user, membership, memberships };
}

export async function setActiveOrganisation(organisationId) {
  const session = await getCurrentSession();

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
    include: { organisation: true }
  });

  if (!membership) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to this organisation."
    };
  }

  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { activeOrganisationId: organisationId }
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

  return { ok: true, session, membership };
}

export async function destroySession() {
  const rawToken = cookies().get(SESSION_COOKIE)?.value;

  if (rawToken) {
    await prisma.session.deleteMany({
      where: {
        tokenHash: hashSessionToken(rawToken)
      }
    });
  }

  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/"
  });
}

