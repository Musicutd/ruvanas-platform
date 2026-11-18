import bcrypt from "bcryptjs";
import { z } from "zod";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { isPrivatePreviewAdminSession, readPrivatePreviewPolicy } from "./private-preview-policy.mjs";

const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/);
const finite = value => value instanceof Date && Number.isFinite(value.getTime());
const text = (min, max) => z.string().max(max).trim().min(min)
  .refine(value => value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value));
const slugSchema = z.string().max(180).trim().toLowerCase().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const ordinaryOwnerInputSchema = z.object({
  name: text(2, 160),
  slug: slugSchema.optional(),
  planId: idSchema,
  ownerName: text(2, 100),
  ownerEmail: z.string().max(254).trim().toLowerCase().email().regex(/^[\x21-\x7e]+$/),
  password: z.string().max(72).refine(value => [...value].length >= 15 &&
    Buffer.byteLength(value, "utf8") <= 72 && !value.includes("\0") && value.isWellFormed()),
  confirmCreate: z.literal(true)
}).strict();
export const ordinaryOwnerProvisioningSchema = ordinaryOwnerInputSchema;

const failures = Object.freeze({
  INVALID_REQUEST: [400, "Complete the organisation and owner details, use a password of at least 15 characters and no more than 72 UTF-8 bytes, and confirm creation."],
  AUTH_REQUIRED: [401, "Your session has expired. Please sign in again."],
  FORBIDDEN: [403, "Sign in with an established Super Admin account to create an organisation owner."],
  EMAIL_EXISTS: [409, "This email address already belongs to an account or prepared shopper. Use a separate new owner email."],
  SLUG_EXISTS: [409, "An organisation with this slug already exists. Choose another slug."],
  PLAN_UNAVAILABLE: [409, "Choose an active public Retail plan with Retail Radio enabled."],
  CONFLICT: [409, "An account or organisation already exists with these details. No new organisation was created."],
  UNAVAILABLE: [503, "Unable to create the organisation owner. Please try again."]
});
function denied(code) {
  const [status, error] = failures[code] || failures.UNAVAILABLE;
  return { ok: false, status, code: failures[code] ? code : "UNAVAILABLE", error };
}
class ProvisioningDenied extends Error {
  constructor(code) { super("Ordinary owner provisioning declined."); this.code = code; }
}
const abort = code => { throw new ProvisioningDenied(code); };

/** Shared page/HTTP gate. Database authority is independently reloaded by the service. */
export function authorizeOrdinaryOwnerSession(session, now, env = {}) {
  try {
    if (!finite(now)) return denied("UNAVAILABLE");
    if (!session || !idSchema.safeParse(session.id).success || !idSchema.safeParse(session.userId).success ||
        session.user?.id !== session.userId || session.revokedAt !== null || !finite(session.expiresAt) ||
        session.expiresAt <= now || !finite(session.createdAt) || session.createdAt > now ||
        !finite(session.lastSeenAt) || session.lastSeenAt > now) return denied("AUTH_REQUIRED");
    if (session.user.role !== "SUPER_ADMIN") return denied("FORBIDDEN");
    const preview = readPrivatePreviewPolicy(env);
    if (!preview.valid) return denied("UNAVAILABLE");
    if (preview.enabled ? !isPrivatePreviewAdminSession(session, preview) :
      !["PASSWORD", "SSO"].includes(session.authMethod) || session.user.privatePreviewAccess != null) return denied("FORBIDDEN");
    const policy = session.activeOrganisation?.enterpriseSecurityPolicy;
    if (policy && (!Number.isInteger(policy.sessionMaxAgeMinutes) || policy.sessionMaxAgeMinutes <= 0 ||
        !Number.isInteger(policy.idleTimeoutMinutes) || policy.idleTimeoutMinutes <= 0)) return denied("UNAVAILABLE");
    if (policy && (session.createdAt.getTime() + policy.sessionMaxAgeMinutes * 60_000 <= now.getTime() ||
        session.lastSeenAt.getTime() + policy.idleTimeoutMinutes * 60_000 <= now.getTime())) return denied("AUTH_REQUIRED");
    return { ok: true, userId: session.userId, sessionId: session.id };
  } catch { return denied("UNAVAILABLE"); }
}

const sessionSelect = {
  id: true, userId: true, authMethod: true, revokedAt: true, expiresAt: true, createdAt: true, lastSeenAt: true,
  user: { select: { id: true, email: true, role: true, privatePreviewAccess: { select: {
    userId: true, enabled: true, passwordEnabled: true, organisationId: true, expiresAt: true, pillars: true
  } } } },
  activeOrganisation: { select: { enterpriseSecurityPolicy: { select: { sessionMaxAgeMinutes: true, idleTimeoutMinutes: true } } } }
};
const planSelect = { id: true, code: true, active: true, publiclyAvailable: true, productFamily: true, retailRadioEnabled: true };
function validPlan(plan, planId) {
  return plan?.id === planId && plan.active === true && plan.publiclyAvailable === true &&
    plan.productFamily === "RETAIL" && plan.retailRadioEnabled === true &&
    typeof plan.code === "string" && !plan.code.trim().toUpperCase().startsWith("PRIVATE_PREVIEW_");
}

/** Creates only a new ordinary owner and tenant. This grants no Rewards access. */
export function createOrdinaryOwnerService({ db, loadSession, env = {},
  hashPassword = (password, cost) => bcrypt.hash(password, cost), clock = () => new Date() } = {}) {
  function nowAt(earliest) {
    const now = clock();
    if (!finite(now) || earliest && now < earliest) abort("UNAVAILABLE");
    return new Date(now);
  }
  async function authority(client, previous, authMethod, earliest) {
    const session = await client.session.findUnique({ where: { id: previous.sessionId }, select: sessionSelect });
    const access = authorizeOrdinaryOwnerSession(session, nowAt(earliest), env);
    if (!access.ok) abort(access.code);
    if (access.sessionId !== previous.sessionId || access.userId !== previous.userId || session.authMethod !== authMethod) abort("FORBIDDEN");
    // The ordinary getCurrentSession shape may omit this relation; a database
    // reload must positively confirm its absence rather than trust omission.
    if (session.user.privatePreviewAccess === undefined) abort("UNAVAILABLE");
    return access;
  }
  async function eligibility(client, values, slug) {
    const insensitiveEmail = { equals: values.ownerEmail, mode: "insensitive" };
    // The transaction repeats all four identity reads at Serializable isolation
    // so concurrent owner, invitation and dormant-setup writes cannot share email.
    const [user, credential, invitation, setup, organisation, plan] = await Promise.all([
      client.user.findFirst({ where: { email: insensitiveEmail }, select: { id: true } }),
      client.rewardShopperCredential.findFirst({ where: { emailCanonical: insensitiveEmail }, select: { shopperId: true } }),
      client.rewardShopperInvitation.findFirst({ where: { emailCanonical: insensitiveEmail }, select: { shopperId: true } }),
      client.rewardShopperSetup.findFirst({ where: { emailCanonical: insensitiveEmail }, select: { shopperId: true } }),
      client.organisation.findFirst({ where: { slug: { equals: slug, mode: "insensitive" } }, select: { id: true } }),
      client.plan.findUnique({ where: { id: values.planId }, select: planSelect })
    ]);
    if (user || credential || invitation || setup) abort("EMAIL_EXISTS");
    if (organisation) abort("SLUG_EXISTS");
    if (!validPlan(plan, values.planId)) abort("PLAN_UNAVAILABLE");
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
      const access = authorizeOrdinaryOwnerSession(session, nowAt(started), env);
      if (!access.ok) return access;
      const parsed = ordinaryOwnerInputSchema.safeParse(input);
      if (!parsed.success) return denied("INVALID_REQUEST");
      const values = parsed.data, authMethod = session.authMethod;
      const slug = values.slug ?? values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slugSchema.safeParse(slug).success) return denied("INVALID_REQUEST");
      await authority(db, access, authMethod, started);
      await eligibility(db, values, slug);
      await authority(db, access, authMethod, started);
      const passwordHash = await hashPassword(values.password, 12);
      if (typeof passwordHash !== "string" || !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)) abort("UNAVAILABLE");
      const hashedAt = nowAt(started);
      return await runSerializableTransaction(db, async tx => {
        await lockAuthority(tx, access);
        await authority(tx, access, authMethod, hashedAt);
        const plans = await tx.$queryRaw`SELECT "id" FROM "Plan" WHERE "id" = ${values.planId} FOR SHARE`;
        if (plans.length !== 1 || plans[0].id !== values.planId) abort("PLAN_UNAVAILABLE");
        await eligibility(tx, values, slug);
        const owner = await tx.user.create({ data: { name: values.ownerName, email: values.ownerEmail, passwordHash, role: "OWNER" },
          select: { id: true, name: true, email: true, role: true } });
        const organisation = await tx.organisation.create({ data: { name: values.name, slug }, select: { id: true, name: true, slug: true } });
        if (!idSchema.safeParse(owner?.id).success || owner.name !== values.ownerName || owner.email !== values.ownerEmail || owner.role !== "OWNER" ||
            !idSchema.safeParse(organisation?.id).success || organisation.name !== values.name || organisation.slug !== slug) abort("UNAVAILABLE");
        await tx.organisationMember.create({ data: { userId: owner.id, organisationId: organisation.id, role: "OWNER" } });
        await tx.subscription.create({ data: { organisationId: organisation.id, planId: values.planId, status: "TRIAL" } });
        await tx.auditLog.create({ data: { organisationId: organisation.id, actorUserId: access.userId,
          action: "ORDINARY_OWNER_ORGANISATION_CREATED", entityType: "Organisation", entityId: organisation.id,
          details: { ownerUserId: owner.id, ownerRole: "OWNER", planId: values.planId, subscriptionStatus: "TRIAL" } } });
        await authority(tx, access, authMethod, hashedAt);
        return { ok: true, organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
          owner: { id: owner.id, name: owner.name, email: owner.email, role: "OWNER" } };
      });
    } catch (error) {
      return denied(error instanceof ProvisioningDenied ? error.code : error?.code === "P2002" ? "CONFLICT" : "UNAVAILABLE");
    }
  } });
}
