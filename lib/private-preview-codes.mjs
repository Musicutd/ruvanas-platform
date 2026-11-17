import { createHmac, randomBytes } from "node:crypto";
import { isPrivatePreviewUserAllowed } from "./private-preview-policy.mjs";
import { hashSessionToken } from "./session-lookup.js";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { assertPreviewTesterState } from "./private-preview-account-policy.mjs";

export const PREVIEW_CODE_PENDING_AUTH_METHOD = "PREVIEW_LOGIN_CODE";
export const PREVIEW_CODE_AUTH_METHOD = "PREVIEW_CODE";
export const PREVIEW_CODE_TTL_HOURS = 24;

const CODE_PATTERN = /^rvp_[a-f0-9]{48}$/;
const CODE_DOMAIN = "private-preview-code:v1:";
const SESSION_TTL_DAYS = 30;

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  privatePreviewAccess: true,
  memberships: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      organisationId: true,
      role: true,
      organisation: {
        select: {
          subscription: { include: { plan: true, billingContract: true } },
          enterpriseSecurityPolicy: {
            select: { ssoRequired: true, passwordFallback: true }
          }
        }
      }
    }
  }
};

export class PrivatePreviewCodeError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "PrivatePreviewCodeError";
    this.code = code;
    this.status = status;
  }
}

function error(code, status) {
  return new PrivatePreviewCodeError(code, status);
}

function validTime(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw error("PREVIEW_UNAVAILABLE", 503);
  return date;
}

function requirePolicy(policy) {
  if (!policy?.enabled || !policy.valid ||
    typeof policy.adminEmail !== "string" || !policy.adminEmail) {
    throw error("PREVIEW_UNAVAILABLE", 503);
  }
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw error("PREVIEW_UNAVAILABLE", 503);
}

function requireOwner(actor, policy) {
  if (!actor || actor.role !== "SUPER_ADMIN" ||
    actor.email?.trim().toLowerCase() !== policy.adminEmail ||
    !isPrivatePreviewUserAllowed(actor, policy)) {
    throw error("FORBIDDEN", 403);
  }
}

async function targetOrganisationId(db, user, now, publicCode, publicStatus) {
  let state;
  try {
    state = assertPreviewTesterState(user, { now, requirePassword: false });
  } catch {
    // Do not disclose whether enrollment, a plan/rights setting, expiry or
    // tenant membership changed. No pending code is consumed on this path.
    throw error(publicCode, publicStatus);
  }
  if (await db.organisationMember.count({ where: { organisationId: state.grant.organisationId } }) !== 1) {
    throw error(publicCode, publicStatus);
  }
  return state.grant.organisationId;
}

async function loadUser(db, id) {
  if (typeof id !== "string" || !id) return null;
  return db.user.findUnique({ where: { id }, select: USER_SELECT });
}

async function safeTransaction(db, operation) {
  try {
    return await runSerializableTransaction(db, operation);
  } catch (caught) {
    if (caught instanceof PrivatePreviewCodeError) throw caught;
    throw error("PREVIEW_UNAVAILABLE", 503);
  }
}

export function hashPrivatePreviewCode(code, secret = process.env.SESSION_SECRET) {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) throw error("INVALID_CODE", 401);
  requireSecret(secret);
  return createHmac("sha256", secret).update(CODE_DOMAIN).update(code).digest("hex");
}

export async function issuePrivatePreviewCode(db, {
  actorUserId, targetUserId, policy, secret = process.env.SESSION_SECRET, now = new Date()
} = {}) {
  requirePolicy(policy);
  requireSecret(secret);
  const issuedAt = validTime(now);
  const code = `rvp_${randomBytes(24).toString("hex")}`;
  const codeHash = hashPrivatePreviewCode(code, secret);
  const expiresAt = new Date(issuedAt.getTime() + PREVIEW_CODE_TTL_HOURS * 60 * 60 * 1000);

  return safeTransaction(db, async (tx) => {
    const [actor, target] = await Promise.all([
      loadUser(tx, actorUserId), loadUser(tx, targetUserId)
    ]);
    requireOwner(actor, policy);
    if (!target || ["SUPER_ADMIN", "SUPPORT"].includes(target.role) ||
        !isPrivatePreviewUserAllowed(target, policy)) throw error("TARGET_UNAVAILABLE", 404);
    await targetOrganisationId(tx, target, issuedAt, "TARGET_UNAVAILABLE", 404);

    await tx.session.updateMany({
      where: {
        userId: target.id,
        authMethod: PREVIEW_CODE_PENDING_AUTH_METHOD,
        revokedAt: null
      },
      data: { revokedAt: issuedAt }
    });
    const pending = await tx.session.create({
      data: {
        userId: target.id,
        tokenHash: codeHash,
        authMethod: PREVIEW_CODE_PENDING_AUTH_METHOD,
        expiresAt,
        createdAt: issuedAt,
        lastSeenAt: issuedAt
      }
    });
    await tx.auditLog.create({ data: {
      actorUserId: actor.id,
      action: "PRIVATE_PREVIEW_CODE_ISSUED",
      entityType: "Session",
      entityId: pending.id,
      details: { targetUserId: target.id, expiresAt: expiresAt.toISOString() }
    } });
    return { code, id: pending.id, expiresAt, user: { id: target.id, email: target.email } };
  });
}

export async function redeemPrivatePreviewCode(db, {
  code, policy, secret = process.env.SESSION_SECRET, now = new Date()
} = {}) {
  requirePolicy(policy);
  requireSecret(secret);
  const redeemedAt = validTime(now);
  const codeHash = hashPrivatePreviewCode(code, secret);

  return safeTransaction(db, async (tx) => {
    const pending = await tx.session.findUnique({ where: { tokenHash: codeHash }, select: {
      id: true, userId: true, authMethod: true, revokedAt: true, expiresAt: true
    } });
    if (!pending || pending.authMethod !== PREVIEW_CODE_PENDING_AUTH_METHOD ||
      pending.revokedAt || pending.expiresAt <= redeemedAt) throw error("INVALID_CODE", 401);
    const user = await loadUser(tx, pending.userId);
    if (!user || ["SUPER_ADMIN", "SUPPORT"].includes(user.role) ||
        !isPrivatePreviewUserAllowed(user, policy)) throw error("INVALID_CODE", 401);
    const activeOrganisationId = await targetOrganisationId(tx, user, redeemedAt, "INVALID_CODE", 401);

    const claimed = await tx.session.updateMany({
      where: {
        id: pending.id,
        userId: user.id,
        tokenHash: codeHash,
        authMethod: PREVIEW_CODE_PENDING_AUTH_METHOD,
        revokedAt: null,
        expiresAt: { gt: redeemedAt }
      },
      data: { revokedAt: redeemedAt }
    });
    if (claimed.count !== 1) throw error("INVALID_CODE", 401);

    const rawSessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(redeemedAt.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const session = await tx.session.create({ data: {
      userId: user.id,
      activeOrganisationId,
      tokenHash: hashSessionToken(rawSessionToken, secret),
      authMethod: PREVIEW_CODE_AUTH_METHOD,
      expiresAt,
      createdAt: redeemedAt,
      lastSeenAt: redeemedAt
    } });
    await tx.auditLog.create({ data: {
      actorUserId: user.id,
      action: "PRIVATE_PREVIEW_CODE_REDEEMED",
      entityType: "Session",
      entityId: session.id,
      details: { pendingSessionId: pending.id }
    } });
    return {
      user: { id: user.id, email: user.email, role: user.role, privatePreviewAccess: user.privatePreviewAccess },
      rawSessionToken,
      expiresAt,
      activeOrganisationId
    };
  });
}

export async function revokePrivatePreviewCodes(db, {
  actorUserId, targetUserId, policy, now = new Date()
} = {}) {
  requirePolicy(policy);
  const revokedAt = validTime(now);
  return safeTransaction(db, async (tx) => {
    const [actor, target] = await Promise.all([
      loadUser(tx, actorUserId), loadUser(tx, targetUserId)
    ]);
    requireOwner(actor, policy);
    if (!target) throw error("TARGET_UNAVAILABLE", 404);
    const pending = await tx.session.updateMany({
      where: { userId: target.id, authMethod: PREVIEW_CODE_PENDING_AUTH_METHOD, revokedAt: null },
      data: { revokedAt }
    });
    const sessions = await tx.session.updateMany({
      where: { userId: target.id, authMethod: PREVIEW_CODE_AUTH_METHOD, revokedAt: null },
      data: { revokedAt }
    });
    await tx.auditLog.create({ data: {
      actorUserId: actor.id,
      action: "PRIVATE_PREVIEW_CODE_ACCESS_REVOKED",
      entityType: "User",
      entityId: target.id,
      details: { pendingRevokedCount: pending.count, sessionsRevokedCount: sessions.count }
    } });
    return { pendingRevokedCount: pending.count, sessionsRevokedCount: sessions.count };
  });
}
