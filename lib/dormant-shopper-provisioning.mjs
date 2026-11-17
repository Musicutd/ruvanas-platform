import { z } from "zod";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { authorizeOrdinaryOwnerSession } from "./ordinary-owner-provisioning.mjs";

const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/);
const finite = value => value instanceof Date && Number.isFinite(value.getTime());
const nameSchema = z.string().max(80).trim().min(1)
  .refine(value => value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value));
const organisationNameSchema = z.string().min(1).max(160)
  .refine(value => value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value));
export const dormantShopperInputSchema = z.object({
  organisationId: idSchema,
  email: z.string().max(254).trim().toLowerCase().email().regex(/^[\x21-\x7e]+$/),
  displayName: nameSchema,
  confirmCreate: z.literal(true)
}).strict();

const failures = Object.freeze({
  INVALID_REQUEST: [400, "Choose a workspace, enter the shopper's name and email, and confirm disabled account preparation."],
  AUTH_REQUIRED: [401, "Your session has expired. Please sign in again."],
  FORBIDDEN: [403, "Sign in with an established Super Admin account to prepare a disabled shopper."],
  EMAIL_EXISTS: [409, "This email address already belongs to an account, shopper invitation or prepared shopper. Existing identities cannot be changed here."],
  ORGANISATION_UNAVAILABLE: [409, "The selected workspace is unavailable."],
  CONFLICT: [409, "A shopper already exists with these details. Check existing records before trying again."],
  UNAVAILABLE: [503, "The disabled shopper could not be prepared. Please try again later."]
});
function denied(code) {
  const key = Object.hasOwn(failures, code) ? code : "UNAVAILABLE";
  const [status, error] = failures[key];
  return { ok: false, status, code: key, error };
}
class ProvisioningDenied extends Error {
  constructor(code) { super("Disabled shopper preparation declined."); this.code = code; }
}
const abort = code => { throw new ProvisioningDenied(code); };

// This platform-administration boundary is deliberately separate from Rewards
// activation. It reuses established Super Admin authority, not a feature bypass.
export function authorizeDormantShopperSession(session, now, env = {}) {
  const result = authorizeOrdinaryOwnerSession(session, now, env);
  return result.ok ? result : denied(result.code);
}

const sessionSelect = {
  id: true, userId: true, authMethod: true, revokedAt: true, expiresAt: true, createdAt: true, lastSeenAt: true,
  user: { select: { id: true, email: true, role: true, privatePreviewAccess: { select: {
    userId: true, enabled: true, passwordEnabled: true, organisationId: true, expiresAt: true, pillars: true
  } } } },
  activeOrganisation: { select: { enterpriseSecurityPolicy: { select: { sessionMaxAgeMinutes: true, idleTimeoutMinutes: true } } } }
};

/** Creates an inert consumer identity and provenance only. No credential,
 * invitation, membership, session, business account or Rewards grant is issued. */
export function createDormantShopperService({ db, loadSession, env = {}, clock = () => new Date() } = {}) {
  function nowAt(earliest) {
    const now = clock();
    if (!finite(now) || earliest && now < earliest) abort("UNAVAILABLE");
    return new Date(now);
  }
  async function authority(client, previous, authMethod, earliest) {
    const session = await client.session.findUnique({ where: { id: previous.sessionId }, select: sessionSelect });
    const access = authorizeDormantShopperSession(session, nowAt(earliest), env);
    if (!access.ok) abort(access.code);
    if (access.sessionId !== previous.sessionId || access.userId !== previous.userId || session.authMethod !== authMethod) abort("FORBIDDEN");
    // Session loaders can omit this relation; the database re-read must not.
    if (session.user.privatePreviewAccess === undefined) abort("UNAVAILABLE");
    return access;
  }
  async function eligibility(client, values) {
    const email = { equals: values.email, mode: "insensitive" };
    const [user, credential, invitation, setup, organisation] = await Promise.all([
      client.user.findFirst({ where: { email }, select: { id: true } }),
      client.rewardShopperCredential.findFirst({ where: { emailCanonical: email }, select: { shopperId: true } }),
      client.rewardShopperInvitation.findFirst({ where: { emailCanonical: email }, select: { shopperId: true } }),
      client.rewardShopperSetup.findFirst({ where: { emailCanonical: email }, select: { shopperId: true } }),
      client.organisation.findUnique({ where: { id: values.organisationId }, select: { id: true, name: true } })
    ]);
    if (user || credential || invitation || setup) abort("EMAIL_EXISTS");
    if (!organisation || organisation.id !== values.organisationId) abort("ORGANISATION_UNAVAILABLE");
    if (!organisationNameSchema.safeParse(organisation.name).success) abort("UNAVAILABLE");
    return organisation;
  }
  async function lockAuthority(tx, access) {
    const users = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${access.userId} FOR SHARE`;
    const sessions = await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${access.sessionId} AND "userId" = ${access.userId} FOR SHARE`;
    if (users.length !== 1 || users[0].id !== access.userId || sessions.length !== 1 || sessions[0].id !== access.sessionId) abort("AUTH_REQUIRED");
    await tx.$queryRaw`SELECT "userId" FROM "PrivatePreviewAccess" WHERE "userId" = ${access.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT p."id" FROM "EnterpriseSecurityPolicy" p JOIN "Session" s ON s."activeOrganisationId" = p."organisationId"
      WHERE s."id" = ${access.sessionId} FOR SHARE OF p`;
  }
  return Object.freeze({ async create(input) {
    try {
      const started = nowAt();
      if (typeof loadSession !== "function") return denied("AUTH_REQUIRED");
      const session = await loadSession();
      const access = authorizeDormantShopperSession(session, nowAt(started), env);
      if (!access.ok) return access;
      const parsed = dormantShopperInputSchema.safeParse(input);
      if (!parsed.success) return denied("INVALID_REQUEST");
      const values = parsed.data, authMethod = session.authMethod;
      await authority(db, access, authMethod, started);
      await eligibility(db, values);
      return await runSerializableTransaction(db, async tx => {
        // Match existing pilot lock order: target workspace, then authority.
        const organisations = await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${values.organisationId} FOR UPDATE`;
        if (organisations.length !== 1 || organisations[0].id !== values.organisationId) abort("ORGANISATION_UNAVAILABLE");
        await lockAuthority(tx, access);
        await authority(tx, access, authMethod, started);
        const organisation = await eligibility(tx, values), now = nowAt(started);
        const shopper = await tx.rewardShopper.create({ data: { displayName: values.displayName, status: "DISABLED", authVersion: 1 },
          select: { id: true, displayName: true, status: true, authVersion: true } });
        if (!idSchema.safeParse(shopper?.id).success || shopper.displayName !== values.displayName ||
            shopper.status !== "DISABLED" || shopper.authVersion !== 1) abort("UNAVAILABLE");
        const setup = await tx.rewardShopperSetup.create({ data: { shopperId: shopper.id, emailCanonical: values.email,
          organisationId: values.organisationId, createdByUserId: access.userId, createdAt: now },
          select: { shopperId: true, emailCanonical: true, organisationId: true, createdByUserId: true } });
        if (setup?.shopperId !== shopper.id || setup.emailCanonical !== values.email ||
            setup.organisationId !== values.organisationId || setup.createdByUserId !== access.userId) abort("UNAVAILABLE");
        await tx.auditLog.create({ data: { organisationId: values.organisationId, actorUserId: access.userId,
          action: "DORMANT_SHOPPER_PREPARED", entityType: "RewardShopper", entityId: shopper.id,
          details: { shopperId: shopper.id, status: "DISABLED", accessGranted: false } } });
        await authority(tx, access, authMethod, now);
        return { ok: true, organisation: { id: organisation.id, name: organisation.name },
          shopper: { id: shopper.id, email: values.email, displayName: shopper.displayName, status: "DISABLED" } };
      });
    } catch (error) {
      return denied(error instanceof ProvisioningDenied ? error.code : error?.code === "P2002" ? "CONFLICT" : "UNAVAILABLE");
    }
  } });
}
