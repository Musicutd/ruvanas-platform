import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { selectActiveMembership } from "./active-organisation.mjs";

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

export async function getCurrentSession() {
  const rawToken = cookies().get(SESSION_COOKIE)?.value;

  if (!rawToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: hashToken(rawToken)
    },
    include: {
      user: true
    }
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  return session;
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

