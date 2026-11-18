import bcrypt from "bcryptjs";
import { randomBytes, createHmac } from "node:crypto";
import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { canonicalEmailSchema } from "./shopper-auth-contracts.mjs";
import { readPilotPreviewPolicy } from "./pilot-preview-policy.mjs";
import { pilotBusinessLanding } from "./pilot-preview-business.mjs";
import { runSerializableTransaction } from "../transaction-retry.mjs";

export const pilotLoginSchema = z.object({ email: canonicalEmailSchema,
  password: z.string().min(1).max(256).refine(value => Buffer.byteLength(value, "utf8") <= 72),
  organisationId: rewardIdSchema.optional() }).strict();
const HASH = /^\$2[aby]\$(?:0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/;
const DUMMY_HASH = "$2a$12$tMXpeH0lil7Cmm8ozQ/hnenJOJsnNAhD5ZZVM4xCy1ILRUHdQjx7i";
const roles = new Set(["OWNER", "MANAGER", "CONTENT_EDITOR", "VIEWER"]);
const select = { id: true, email: true, role: true, passwordHash: true,
  privatePreviewAccess: { select: { userId: true } }, memberships: { take: 1001, orderBy: { id: "asc" },
    select: { id: true, userId: true, organisationId: true, role: true,
      organisation: { select: { id: true, enterpriseSecurityPolicy: true } } } } };
const failure = (code = "AUTH_FAILED") => ({ ok: false, code });
class Denial extends Error {}

export function pilotLoginIdentity(user, organisationId, env) {
  const policy = readPilotPreviewPolicy(env);
  if (!policy.enabled || !user || !rewardIdSchema.safeParse(user.id).success || user.privatePreviewAccess != null) return null;
  if (user.role === "SUPER_ADMIN") {
    if (organisationId !== undefined && !policy.organisationIds.includes(organisationId)) return null;
    return { userId: user.id, organisationId: null, role: "SUPER_ADMIN", memberId: null };
  }
  if (!roles.has(user.role) || !Array.isArray(user.memberships) || user.memberships.length > 1000) return null;
  const eligible = user.memberships.filter(member => member.userId === user.id && roles.has(member.role) &&
    rewardIdSchema.safeParse(member.id).success && policy.organisationIds.includes(member.organisationId) &&
    member.organisation?.id === member.organisationId && (organisationId === undefined || organisationId === member.organisationId));
  if (eligible.length !== 1) return null;
  const member = eligible[0], security = member.organisation.enterpriseSecurityPolicy;
  // A pilot password endpoint never overrides a tenant's SSO-only requirement.
  if (security?.ssoRequired && !security.passwordFallback) return null;
  return { userId: user.id, organisationId: member.organisationId, role: member.role, memberId: member.id };
}

export function createPilotLoginService({ db, env, clock = () => new Date() }) {
  return { async login(input) {
    try {
      if (!readPilotPreviewPolicy(env).enabled) return failure("FEATURE_DISABLED");
      const parsed = pilotLoginSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_REQUEST");
      if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) return failure("UNAVAILABLE");
      const { email, password, organisationId } = parsed.data, secret = env.SESSION_SECRET;
      const candidate = await db.user.findUnique({ where: { email }, select });
      const supported = candidate?.email === email && HASH.test(candidate?.passwordHash || "");
      const matched = await bcrypt.compare(password, supported ? candidate.passwordHash : DUMMY_HASH);
      if (!supported || !matched || !pilotLoginIdentity(candidate, organisationId, env)) return failure();
      return await runSerializableTransaction(db, async tx => {
        const locked = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.id} FOR SHARE`;
        if (locked.length !== 1) throw new Denial();
        const current = await tx.user.findUnique({ where: { id: candidate.id }, select });
        const identity = pilotLoginIdentity(current, organisationId, env);
        if (!identity || current.email !== email || current.passwordHash !== candidate.passwordHash) throw new Denial();
        if (identity.memberId) {
          const members = await tx.$queryRaw`SELECT "id" FROM "OrganisationMember" WHERE "id" = ${identity.memberId} FOR SHARE`;
          if (members.length !== 1) throw new Denial();
          await tx.$queryRaw`SELECT "organisationId" FROM "EnterpriseSecurityPolicy" WHERE "organisationId" = ${identity.organisationId} FOR SHARE`;
        }
        const now = clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid clock");
        const rawSessionToken = randomBytes(32).toString("hex"), expiresAt = new Date(now.getTime() + 3_600_000);
        await tx.session.create({ data: { userId: identity.userId, activeOrganisationId: identity.organisationId,
          authMethod: "PASSWORD", tokenHash: createHmac("sha256", secret).update(rawSessionToken).digest("hex"),
          createdAt: now, lastSeenAt: now, expiresAt } });
        const finalIdentity = pilotLoginIdentity(current, organisationId, env), finishedAt = clock();
        if (!finalIdentity || JSON.stringify(finalIdentity) !== JSON.stringify(identity) || env.SESSION_SECRET !== secret ||
            !(finishedAt instanceof Date) || !Number.isFinite(finishedAt.getTime()) || finishedAt < now || finishedAt >= expiresAt) throw new Denial();
        return { ok: true, rawSessionToken, expiresAt, landing: pilotBusinessLanding(identity.role) };
      });
    } catch (error) { return failure(error instanceof Denial ? "AUTH_FAILED" : "UNAVAILABLE"); }
  } };
}
