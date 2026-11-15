import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { runSerializableTransaction } from "../transaction-retry.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { rewardsDenied } from "./errors.mjs";
import { hashShopperSessionToken } from "./shopper-access.mjs";
import { readShopperAuthPolicy, canonicalEmailSchema, acceptShopperInvitationSchema, shopperLoginSchema } from "./shopper-auth-contracts.mjs";
import { pilotPreviewShopperAllowed } from "./pilot-preview-shopper.mjs";

const TOKEN = /^[a-f0-9]{64}$/;
const HASH = /^\$2[ab]\$12\$[./A-Za-z0-9]{53}$/;
const DAY_MS = 86_400_000;
// A valid cost-12 hash makes absent accounts and unsupported stored hashes take
// the same bcrypt comparison path. Matching it never authenticates an account.
const DUMMY_HASH = "$2a$12$tMXpeH0lil7Cmm8ozQ/hnenJOJsnNAhD5ZZVM4xCy1ILRUHdQjx7i";
const finiteDate = z.date().refine(value => Number.isFinite(value.getTime()));
const version = z.number().int().positive().max(2_147_483_647);
const shopperSchema = z.object({ id: rewardIdSchema, status: z.enum(["DISABLED", "ACTIVE", "SUSPENDED"]), authVersion: version }).strict();
const membershipSchema = z.object({ id: rewardIdSchema, shopperId: rewardIdSchema, status: z.literal("ACTIVE"),
  source: z.literal("MANUAL_INTERNAL"), startsAt: finiteDate, expiresAt: finiteDate, revokedAt: z.null(), version }).strict();
const invitationSchema = z.object({ id: rewardIdSchema, shopperId: rewardIdSchema, emailCanonical: canonicalEmailSchema,
  tokenHash: z.string().regex(TOKEN), authVersion: version, createdAt: finiteDate, expiresAt: finiteDate,
  revokedAt: z.null(), acceptedAt: z.null() }).strict();
const credentialSchema = z.object({ shopperId: rewardIdSchema, emailCanonical: canonicalEmailSchema,
  passwordHash: z.string().regex(HASH), shopper: shopperSchema }).strict();
const shopperSelect = Object.freeze({ id: true, status: true, authVersion: true });
const membershipSelect = Object.freeze({ id: true, shopperId: true, status: true, source: true,
  startsAt: true, expiresAt: true, revokedAt: true, version: true });
const invitationSelect = Object.freeze({ id: true, shopperId: true, emailCanonical: true, tokenHash: true,
  authVersion: true, createdAt: true, expiresAt: true, revokedAt: true, acceptedAt: true });
const credentialSelect = Object.freeze({ shopperId: true, emailCanonical: true, passwordHash: true,
  shopper: { select: shopperSelect } });

class AuthDenial extends Error {
  constructor(code) { super("Shopper authentication declined."); this.code = code; }
}
const abort = code => { throw new AuthDenial(code); };
function nowAt(clock, earliest) {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || (earliest && now < earliest)) throw new Error("Invalid clock.");
  return new Date(now.getTime());
}
function secretFor(env) {
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) throw new Error("Shopper authentication configuration is unavailable.");
  return env.SESSION_SECRET;
}
function sameEmail(value) {
  const parsed = canonicalEmailSchema.safeParse(value);
  return parsed.success && parsed.data === value;
}
function currentInvitation(row, now, expectedHash) {
  const parsed = invitationSchema.safeParse(row);
  return parsed.success && sameEmail(row.emailCanonical) && row.tokenHash === expectedHash &&
    row.createdAt <= now && now < row.expiresAt && row.createdAt < row.expiresAt &&
    row.expiresAt - row.createdAt <= DAY_MS;
}
function currentMembership(row, shopperId, now) {
  const parsed = membershipSchema.safeParse(row);
  return parsed.success && row.shopperId === shopperId && row.startsAt <= now && now < row.expiresAt && row.startsAt < row.expiresAt;
}

export function hashShopperInvitationToken(token, secret) {
  if (typeof token !== "string" || !TOKEN.test(token) || typeof secret !== "string" || secret.length < 32) {
    throw new Error("Shopper invitation configuration is unavailable.");
  }
  return createHmac("sha256", secret).update(`ruvanas-rewards-shopper-invitation:v1:${token}`).digest("hex");
}

/** Invitation-only shopper authentication. No business User, Session, role,
 * tenant, billing, mail delivery or registration authority is consulted. */
export function createShopperAuthService({ db, env = {}, clock = () => new Date() } = {}) {
  function enabled() { return readShopperAuthPolicy(env).enabled; }
  function finalCheck(secret, earliest) {
    if (!enabled()) abort("FEATURE_DISABLED");
    if (secretFor(env) !== secret) throw new Error("Authentication configuration changed.");
    return nowAt(clock, earliest);
  }
  async function lockShopperAndMembership(tx, shopperId, denial) {
    // Consistent order: shopper, membership, invitation/credential. Under
    // SERIALIZABLE, an authority change committed while this waits causes a
    // retry; a change after these exact-row locks waits until this transaction
    // completes. This is existing-row ordering, not a global policy gap lock.
    const shoppers = await tx.$queryRaw`SELECT "id" FROM "RewardShopper" WHERE "id" = ${shopperId} FOR UPDATE`;
    if (!Array.isArray(shoppers) || shoppers.length !== 1 || shoppers[0].id !== shopperId) abort(denial);
    const memberships = await tx.$queryRaw`SELECT "id" FROM "RewardShopperMembership" WHERE "shopperId" = ${shopperId} FOR SHARE`;
    if (!Array.isArray(memberships) || memberships.length !== 1) abort(denial);
    const shopper = await tx.rewardShopper.findUnique({ where: { id: shopperId }, select: shopperSelect });
    const membership = await tx.rewardShopperMembership.findUnique({ where: { shopperId }, select: membershipSelect });
    if (!shopperSchema.safeParse(shopper).success || shopper.id !== shopperId || membership?.id !== memberships[0].id) abort(denial);
    if (!await pilotPreviewShopperAllowed({ db: tx, env, shopperId })) abort(denial);
    return { shopper, membership };
  }
  async function newSession(tx, shopper, membership, now, secret) {
    const rawSessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Math.min(now.getTime() + DAY_MS, membership.expiresAt.getTime()));
    if (expiresAt <= now) throw new Error("Session expiry unavailable.");
    await tx.rewardShopperSession.create({ data: { shopperId: shopper.id, authVersion: shopper.authVersion,
      tokenHash: hashShopperSessionToken(rawSessionToken, secret), createdAt: now, expiresAt } });
    return { ok: true, rawSessionToken, expiresAt };
  }
  function failed(error, collisionCode) {
    if (error instanceof AuthDenial) return rewardsDenied(error.code);
    if (collisionCode && error?.code === "P2002") return rewardsDenied(collisionCode);
    return rewardsDenied("UNAVAILABLE");
  }

  return Object.freeze({
    async acceptInvite(input) {
      try {
        if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
        const parsed = acceptShopperInvitationSchema.safeParse(input);
        if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
        const secret = secretFor(env), started = nowAt(clock), values = parsed.data;
        const tokenHash = hashShopperInvitationToken(values.token, secret);
        const candidate = await db.rewardShopperInvitation.findUnique({ where: { tokenHash }, select: invitationSelect });
        if (!currentInvitation(candidate, nowAt(clock, started), tokenHash)) return rewardsDenied("INVITATION_UNAVAILABLE");
        if (!await pilotPreviewShopperAllowed({ db, env, shopperId: candidate.shopperId })) return rewardsDenied("INVITATION_UNAVAILABLE");
        const passwordHash = await bcrypt.hash(values.password, 12);
        if (!HASH.test(passwordHash)) throw new Error("Unsupported password hash.");
        finalCheck(secret, started);
        return await runSerializableTransaction(db, async tx => {
          const { shopper, membership } = await lockShopperAndMembership(tx, candidate.shopperId, "INVITATION_UNAVAILABLE");
          const locked = await tx.$queryRaw`SELECT "id" FROM "RewardShopperInvitation" WHERE "id" = ${candidate.id}
            AND "shopperId" = ${candidate.shopperId} FOR UPDATE`;
          if (!Array.isArray(locked) || locked.length !== 1 || locked[0].id !== candidate.id) abort("INVITATION_UNAVAILABLE");
          const invitation = await tx.rewardShopperInvitation.findUnique({ where: { tokenHash }, select: invitationSelect });
          const existing = await tx.rewardShopperCredential.findUnique({ where: { shopperId: candidate.shopperId }, select: { shopperId: true } });
          const now = finalCheck(secret, started);
          if (!currentInvitation(invitation, now, tokenHash) || invitation.id !== candidate.id || invitation.shopperId !== shopper.id ||
            invitation.emailCanonical !== candidate.emailCanonical || invitation.authVersion !== candidate.authVersion ||
            shopper.status !== "DISABLED" || shopper.authVersion !== invitation.authVersion || existing ||
            !currentMembership(membership, shopper.id, now)) abort("INVITATION_UNAVAILABLE");
          await tx.rewardShopperCredential.create({ data: { shopperId: shopper.id, emailCanonical: invitation.emailCanonical, passwordHash } });
          await tx.rewardShopper.update({ where: { id: shopper.id }, data: { status: "ACTIVE",
            ...(values.displayName === undefined ? {} : { displayName: values.displayName }) } });
          await tx.rewardShopperInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: now } });
          const result = await newSession(tx, shopper, membership, now, secret);
          if (!await pilotPreviewShopperAllowed({ db: tx, env, shopperId: shopper.id })) abort("INVITATION_UNAVAILABLE");
          const beforeCommit = finalCheck(secret, now);
          if (!currentMembership(membership, shopper.id, beforeCommit) || !currentInvitation(invitation, beforeCommit, tokenHash) || result.expiresAt <= beforeCommit) abort("INVITATION_UNAVAILABLE");
          return result;
        });
      } catch (error) { return failed(error, "INVITATION_UNAVAILABLE"); }
    },

    async login(input) {
      try {
        if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
        const parsed = shopperLoginSchema.safeParse(input);
        if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
        const secret = secretFor(env), started = nowAt(clock), values = parsed.data;
        const candidate = await db.rewardShopperCredential.findUnique({ where: { emailCanonical: values.email }, select: credentialSelect });
        const candidateValid = credentialSchema.safeParse(candidate).success && sameEmail(candidate?.emailCanonical) &&
          candidate.emailCanonical === values.email && candidate.shopperId === candidate.shopper.id;
        const matched = await bcrypt.compare(values.password, candidateValid ? candidate.passwordHash : DUMMY_HASH);
        finalCheck(secret, started);
        if (!candidateValid || !matched || candidate.shopper.status !== "ACTIVE") return rewardsDenied("AUTH_FAILED");
        if (!await pilotPreviewShopperAllowed({ db, env, shopperId: candidate.shopperId })) return rewardsDenied("AUTH_FAILED");
        return await runSerializableTransaction(db, async tx => {
          const { shopper, membership } = await lockShopperAndMembership(tx, candidate.shopperId, "AUTH_FAILED");
          const locked = await tx.$queryRaw`SELECT "shopperId" FROM "RewardShopperCredential" WHERE "shopperId" = ${candidate.shopperId} FOR UPDATE`;
          if (!Array.isArray(locked) || locked.length !== 1 || locked[0].shopperId !== candidate.shopperId) abort("AUTH_FAILED");
          const credential = await tx.rewardShopperCredential.findUnique({ where: { shopperId: candidate.shopperId }, select: credentialSelect });
          const now = finalCheck(secret, started);
          if (!credentialSchema.safeParse(credential).success || credential.emailCanonical !== values.email ||
            credential.shopperId !== shopper.id || credential.shopper.id !== shopper.id ||
            credential.passwordHash !== candidate.passwordHash || shopper.status !== "ACTIVE" ||
            shopper.authVersion !== candidate.shopper.authVersion || credential.shopper.authVersion !== shopper.authVersion ||
            !currentMembership(membership, shopper.id, now)) abort("AUTH_FAILED");
          const result = await newSession(tx, shopper, membership, now, secret);
          if (!await pilotPreviewShopperAllowed({ db: tx, env, shopperId: shopper.id })) abort("AUTH_FAILED");
          const beforeCommit = finalCheck(secret, now);
          if (!currentMembership(membership, shopper.id, beforeCommit) || result.expiresAt <= beforeCommit) abort("AUTH_FAILED");
          return result;
        });
      } catch (error) { return failed(error); }
    },

    async logout({ token } = {}) {
      try {
        if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
        if (typeof token !== "string" || !TOKEN.test(token)) return { ok: true };
        const tokenHash = hashShopperSessionToken(token, secretFor(env));
        // An expired session can still be revoked. Possession of this token
        // grants only this idempotent revocation, never access to another row.
        await db.rewardShopperSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: nowAt(clock) } });
        return { ok: true };
      } catch (error) { return failed(error); }
    }
  });
}
