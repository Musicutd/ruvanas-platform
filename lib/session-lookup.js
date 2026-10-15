import crypto from "node:crypto";
import { readPrivatePreviewPolicy, privatePreviewSessionLanding, isPrivatePreviewTester } from "./private-preview-policy.mjs";
import { assertPreviewTesterState, PrivatePreviewAccountError } from "./private-preview-account-policy.mjs";

export const SESSION_COOKIE = "ruvanas_session";

export function hashSessionToken(rawToken, secret = process.env.SESSION_SECRET) {
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }
  return crypto.createHmac("sha256", secret).update(rawToken).digest("hex");
}

// Shared by server components and the Node.js preview middleware. The caller
// supplies Prisma so this module does not depend on next/headers or cookies.
export async function getSessionFromToken(rawToken, { db, secret = process.env.SESSION_SECRET, now = new Date(), env = process.env } = {}) {
  if (!rawToken) return null;
  if (!db?.session?.findUnique || !db?.session?.update) throw new Error("Session database is unavailable.");
  const preview = readPrivatePreviewPolicy(env);

  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(rawToken, secret) },
    include: {
      user: preview.enabled ? { include: { privatePreviewAccess: true, memberships: {
        include: { organisation: { include: { enterpriseSecurityPolicy: true, subscription: { include: { plan: true, billingContract: true } } } } }
      } } } : true,
      activeOrganisation: { include: { enterpriseSecurityPolicy: true } }
    }
  });

  const policy = session?.activeOrganisation?.enterpriseSecurityPolicy;
  const absoluteExpiry = policy
    ? new Date(session.createdAt.getTime() + policy.sessionMaxAgeMinutes * 60 * 1000)
    : session?.expiresAt;
  const idleExpiry = policy
    ? new Date(session.lastSeenAt.getTime() + policy.idleTimeoutMinutes * 60 * 1000)
    : null;

  if (
    !session ||
    session.authMethod === "PREVIEW_LOGIN_CODE" ||
    session.revokedAt ||
    session.expiresAt <= now ||
    (absoluteExpiry && absoluteExpiry <= now) ||
    (idleExpiry && idleExpiry <= now) ||
    (policy?.ssoRequired && !policy.passwordFallback && session.authMethod !== "SSO" && session.user.role !== "SUPER_ADMIN")
  ) {
    return null;
  }

  if (preview.enabled) {
    if (!privatePreviewSessionLanding(session, preview)) return null;
    if (isPrivatePreviewTester(session.user, preview, now)) {
      const access = session.user.privatePreviewAccess;
      try { assertPreviewTesterState(session.user, { now, requirePassword: session.authMethod === "PREVIEW_PASSWORD" }); }
      catch (caught) { if (caught instanceof PrivatePreviewAccountError) return null; throw caught; }
      if (await db.organisationMember.count({ where: { organisationId: access.organisationId } }) !== 1) return null;
    }
  }

  if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    session.lastSeenAt = now;
  }

  return session;
}
