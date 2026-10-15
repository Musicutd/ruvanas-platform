import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { hashSessionToken } from "./session-lookup.js";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { isPrivatePreviewAdmin } from "./private-preview-policy.mjs";
import {
  assertPreviewTesterState, isPreviewTesterPlan, normalizePreviewPillars,
  PREVIEW_TESTER_LIMIT, PREVIEW_TESTER_PLAN, PREVIEW_TESTER_PLAN_CODE,
  previewTesterOverrides, PrivatePreviewAccountError
} from "./private-preview-account-policy.mjs";
export {
  assertPreviewTesterState, PREVIEW_TESTER_LIMIT, PREVIEW_TESTER_PLAN_CODE, PrivatePreviewAccountError
} from "./private-preview-account-policy.mjs";

export const PREVIEW_PASSWORD_AUTH_METHOD = "PREVIEW_PASSWORD";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync("non-account-private-preview-comparison", 12);
const USER_INCLUDE = {
  privatePreviewAccess: true,
  memberships: {
    include: { organisation: { include: {
      enterpriseSecurityPolicy: true,
      subscription: { include: { plan: true, billingContract: true } }
    } } }
  }
};

function fail(code, status) { throw new PrivatePreviewAccountError(code, status); }

function requirePolicy(policy) {
  if (!policy?.enabled || !policy.valid || !policy.adminEmail) fail("PREVIEW_UNAVAILABLE", 503);
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("PREVIEW_UNAVAILABLE", 503);
  return date;
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) fail("PREVIEW_UNAVAILABLE", 503);
}

export function validatePreviewPassword(password) {
  if (typeof password !== "string" || [...password].length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    return { ok: false, error: "Use at least 12 characters and no more than 72 UTF-8 bytes." };
  }
  return { ok: true };
}

function requirePassword(password) {
  if (!validatePreviewPassword(password).ok) fail("INVALID_PASSWORD", 400);
}

function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) fail("INVALID_EMAIL", 400);
  const [local, domain] = email.split("@");
  if (local.length > 64 || !domain.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) {
    fail("INVALID_EMAIL", 400);
  }
  return email;
}

function normalizeName(value) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) fail("INVALID_NAME", 400);
  return name;
}

async function owner(db, actorUserId, policy) {
  const actor = typeof actorUserId === "string" && actorUserId
    ? await db.user.findUnique({ where: { id: actorUserId }, include: USER_INCLUDE }) : null;
  if (!isPrivatePreviewAdmin(actor, policy)) fail("FORBIDDEN", 403);
  return actor;
}

async function atomic(db, operation) {
  try {
    return await runSerializableTransaction(db, operation);
  } catch (error) {
    if (error instanceof PrivatePreviewAccountError) throw error;
    fail("PREVIEW_UNAVAILABLE", 503);
  }
}

async function testerPlan(db) {
  const existing = await db.plan.findUnique({ where: { code: PREVIEW_TESTER_PLAN_CODE } });
  if (existing) {
    if (!isPreviewTesterPlan(existing)) fail("PREVIEW_PLAN_CHANGED", 409);
    return existing;
  }
  return db.plan.create({ data: { ...PREVIEW_TESTER_PLAN } });
}

async function isolatedTester(db, user, options = {}) {
  const state = assertPreviewTesterState(user, options);
  if (await db.organisationMember.count({ where: { organisationId: state.grant.organisationId } }) !== 1) {
    fail("TARGET_UNAVAILABLE", 404);
  }
  return state;
}

function summary(user) {
  const access = user.privatePreviewAccess;
  return {
    id: user.id, email: user.email, name: user.name,
    enabled: access.enabled, passwordEnabled: access.passwordEnabled,
    pillars: [...access.pillars], expiresAt: access.expiresAt
  };
}

function safeUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role,
    privatePreviewAccess: user.privatePreviewAccess };
}

async function audit(db, actorUserId, action, userId, organisationId, details = {}) {
  await db.auditLog.create({ data: {
    actorUserId, action, entityType: "User", entityId: userId,
    ...(organisationId ? { organisationId } : {}), details
  } });
}

async function newSession(db, user, secret, now) {
  const rawSessionToken = randomBytes(32).toString("hex");
  const access = user.privatePreviewAccess;
  const expiry = now.getTime() + TTL_MS;
  const expiresAt = new Date(access?.expiresAt ? Math.min(expiry, access.expiresAt.getTime()) : expiry);
  const activeOrganisationId = access?.organisationId || null;
  await db.session.create({ data: {
    userId: user.id, activeOrganisationId,
    tokenHash: hashSessionToken(rawSessionToken, secret), authMethod: PREVIEW_PASSWORD_AUTH_METHOD,
    expiresAt, createdAt: now, lastSeenAt: now
  } });
  return { user: safeUser(user), rawSessionToken, expiresAt, activeOrganisationId };
}

export async function createPreviewTester(db, {
  actorUserId, policy, email, name, password, pillars, now = new Date()
} = {}) {
  requirePolicy(policy);
  const createdAt = validDate(now);
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);
  const selected = normalizePreviewPillars(pillars);
  if (password !== undefined) requirePassword(password);
  // Code-only accounts still need an unusable User.passwordHash. This random
  // password is never returned or retained; only owner-enabled passwords work.
  const passwordHash = await bcrypt.hash(password === undefined ? randomBytes(48).toString("base64url") : password, 12);
  return atomic(db, async (tx) => {
    const actor = await owner(tx, actorUserId, policy);
    if (await tx.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } })) {
      fail("ACCOUNT_EXISTS", 409);
    }
    if (await tx.privatePreviewAccess.count({ where: { organisationId: { not: null } } }) >= PREVIEW_TESTER_LIMIT) {
      fail("TESTER_LIMIT", 409);
    }
    const plan = await testerPlan(tx);
    const user = await tx.user.create({ data: {
      email: normalizedEmail, name: normalizedName, passwordHash, role: "OWNER"
    } });
    const organisation = await tx.organisation.create({ data: {
      name: `Private preview — ${normalizedName}`, slug: `private-preview-${randomBytes(12).toString("hex")}`
    } });
    await tx.organisationMember.create({ data: { userId: user.id, organisationId: organisation.id, role: "OWNER" } });
    const expiresAt = new Date(createdAt.getTime() + TTL_MS);
    await tx.subscription.create({ data: {
      organisationId: organisation.id, planId: plan.id, status: "TRIAL", currentPeriodEnd: expiresAt,
      ...previewTesterOverrides(selected), schoolPublicPublishingEnabled: false,
      retailMediaEnabled: false, digitalSignageEnabled: false, complimentaryAccessActive: false
    } });
    const access = await tx.privatePreviewAccess.create({ data: {
      userId: user.id, organisationId: organisation.id, enabled: true, passwordEnabled: password !== undefined,
      pillars: selected, expiresAt
    } });
    await audit(tx, actor.id, "PRIVATE_PREVIEW_TESTER_CREATED", user.id, organisation.id,
      { pillars: selected, expiresAt: expiresAt.toISOString() });
    return summary({ ...user, privatePreviewAccess: access });
  });
}

export async function updatePreviewTester(db, {
  actorUserId, policy, userId, pillars, enabled, password, now = new Date()
} = {}) {
  requirePolicy(policy);
  const changedAt = validDate(now);
  const selected = normalizePreviewPillars(pillars);
  if (typeof enabled !== "boolean") fail("INVALID_REQUEST", 400);
  if (password !== undefined) requirePassword(password);
  const passwordHash = password === undefined ? null : await bcrypt.hash(password, 12);
  return atomic(db, async (tx) => {
    const actor = await owner(tx, actorUserId, policy);
    const user = typeof userId === "string" ? await tx.user.findUnique({ where: { id: userId }, include: USER_INCLUDE }) : null;
    if (!user || user.email.toLowerCase() === policy.adminEmail) fail("TARGET_UNAVAILABLE", 404);
    const { grant } = await isolatedTester(tx, user, { now: changedAt, allowInactive: true });
    const expiresAt = enabled ? new Date(changedAt.getTime() + TTL_MS) : grant.expiresAt;
    if (passwordHash) await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.subscription.update({ where: { organisationId: grant.organisationId }, data: {
      ...previewTesterOverrides(selected), currentPeriodEnd: expiresAt
    } });
    const access = await tx.privatePreviewAccess.update({ where: { userId: user.id }, data: {
      enabled, passwordEnabled: passwordHash ? true : grant.passwordEnabled, pillars: selected, expiresAt
    } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: changedAt } });
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: changedAt } });
    await audit(tx, actor.id, "PRIVATE_PREVIEW_TESTER_UPDATED", user.id, grant.organisationId,
      { enabled, pillars: selected, passwordChanged: Boolean(passwordHash), expiresAt: expiresAt.toISOString() });
    return summary({ ...user, privatePreviewAccess: access });
  });
}

export async function listPreviewTesters(db, { actorUserId, policy } = {}) {
  requirePolicy(policy);
  return atomic(db, async (tx) => {
    await owner(tx, actorUserId, policy);
    const grants = await tx.privatePreviewAccess.findMany({
      where: { organisationId: { not: null } }, orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
      take: PREVIEW_TESTER_LIMIT,
      include: { user: { select: { id: true, email: true, name: true } } }
    });
    return grants.map((access) => summary({ ...access.user, privatePreviewAccess: access }));
  });
}

function validSession(session, userId, now) {
  return Boolean(session && session.userId === userId && !session.revokedAt &&
    session.expiresAt instanceof Date && session.expiresAt > now);
}

function validOwnerGrant(user, now) {
  const grant = user.privatePreviewAccess;
  return Boolean(grant && grant.userId === user.id && grant.organisationId === null &&
    grant.enabled && grant.passwordEnabled && grant.expiresAt === null && Array.isArray(grant.pillars) && grant.pillars.length === 0);
}

export async function establishPreviewOwnerPassword(db, {
  actorUserId, sessionId, policy, password, currentPassword, secret = process.env.SESSION_SECRET, now = new Date()
} = {}) {
  requirePolicy(policy);
  requireSecret(secret);
  requirePassword(password);
  const changedAt = validDate(now);
  const passwordHash = await bcrypt.hash(password, 12);
  return atomic(db, async (tx) => {
    const actor = await owner(tx, actorUserId, policy);
    const session = typeof sessionId === "string" ? await tx.session.findUnique({ where: { id: sessionId } }) : null;
    if (!validSession(session, actor.id, changedAt)) fail("FORBIDDEN", 403);
    const established = Boolean(actor.privatePreviewAccess?.passwordEnabled);
    if (established) {
      if (session.authMethod !== PREVIEW_PASSWORD_AUTH_METHOD || !validOwnerGrant(actor, changedAt)) fail("FORBIDDEN", 403);
      if (typeof currentPassword !== "string" || Buffer.byteLength(currentPassword, "utf8") > 72 ||
          !(await bcrypt.compare(currentPassword, actor.passwordHash))) fail("INVALID_CREDENTIALS", 401);
    } else if (session.authMethod !== "PREVIEW_CODE" || (actor.privatePreviewAccess &&
        (!actor.privatePreviewAccess.enabled || actor.privatePreviewAccess.organisationId !== null ||
          actor.privatePreviewAccess.expiresAt !== null || !Array.isArray(actor.privatePreviewAccess.pillars) ||
          actor.privatePreviewAccess.pillars.length !== 0))) {
      fail("FORBIDDEN", 403);
    }
    const access = await tx.privatePreviewAccess.upsert({ where: { userId: actor.id },
      create: { userId: actor.id, organisationId: null, enabled: true, passwordEnabled: true, pillars: [], expiresAt: null },
      update: { organisationId: null, enabled: true, passwordEnabled: true, pillars: [], expiresAt: null }
    });
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: actor.id, revokedAt: null }, data: { revokedAt: changedAt } });
    await tx.passwordResetToken.updateMany({ where: { userId: actor.id, usedAt: null }, data: { usedAt: changedAt } });
    await audit(tx, actor.id, established ? "PRIVATE_PREVIEW_OWNER_PASSWORD_CHANGED" : "PRIVATE_PREVIEW_OWNER_PASSWORD_ESTABLISHED",
      actor.id, null, { previousSessionsRevoked: true });
    return newSession(tx, { ...actor, privatePreviewAccess: access }, secret, changedAt);
  });
}

async function allowedPasswordUser(db, user, policy, now) {
  if (isPrivatePreviewAdmin(user, policy)) return validOwnerGrant(user, now);
  try {
    await isolatedTester(db, user, { now });
    return true;
  } catch (error) {
    if (error instanceof PrivatePreviewAccountError) return false;
    throw error;
  }
}

export async function authenticatePreviewPassword(db, {
  policy, email, password, secret = process.env.SESSION_SECRET, now = new Date()
} = {}) {
  requirePolicy(policy);
  requireSecret(secret);
  const signedInAt = validDate(now);
  let normalizedEmail = null;
  try { normalizedEmail = normalizeEmail(email); } catch { /* Match unknown accounts generically. */ }
  let user, eligible, matched;
  const inputValid = typeof password === "string" && password.length > 0 && Buffer.byteLength(password, "utf8") <= 72;
  try {
    user = normalizedEmail
      ? await db.user.findUnique({ where: { email: normalizedEmail }, include: USER_INCLUDE }) : null;
    eligible = user && await allowedPasswordUser(db, user, policy, signedInAt);
    matched = await bcrypt.compare(inputValid ? password : "invalid-preview-input", eligible && inputValid ? user.passwordHash : DUMMY_HASH);
  } catch {
    fail("PREVIEW_UNAVAILABLE", 503);
  }
  if (!eligible || !inputValid || !matched) fail("INVALID_CREDENTIALS", 401);
  return atomic(db, async (tx) => {
    const current = await tx.user.findUnique({ where: { id: user.id }, include: USER_INCLUDE });
    if (!current || current.passwordHash !== user.passwordHash ||
        !(await allowedPasswordUser(tx, current, policy, signedInAt))) fail("INVALID_CREDENTIALS", 401);
    const result = await newSession(tx, current, secret, signedInAt);
    await audit(tx, current.id, "PRIVATE_PREVIEW_PASSWORD_SIGNED_IN", current.id, result.activeOrganisationId);
    return result;
  });
}
