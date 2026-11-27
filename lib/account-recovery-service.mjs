import bcrypt from "bcryptjs";
import { ACCOUNT_RECOVERY_MESSAGE, accountAllowsPasswordRecovery, createAccountRecoveryToken,
  hashAccountRecoveryToken, normalizeRecoveryEmail, passwordRecoveryOrganisationId,
  resolveRecoveryOrigin, validateRecoveryPassword } from "./account-recovery.mjs";
import { accountRecoveryEmailConfig } from "./account-recovery-email-config.mjs";
import { readPrivatePreviewPolicy } from "./private-preview-policy.mjs";
import { readPrivatePreviewRecoveryPolicy, privatePreviewRecoveryIdentity } from "./private-preview-account-recovery.mjs";
import { readPilotPreviewPolicy } from "./retail-rewards/pilot-preview-policy.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export const recoveryUserSelect = { id: true, email: true, role: true, passwordHash: true,
  privatePreviewAccess: { select: { userId: true } },
  memberships: { take: 1001, orderBy: { id: "asc" }, select: { id: true, userId: true,
    organisationId: true, role: true, organisation: { select: { id: true, enterpriseSecurityPolicy: true } } } } };
const accepted = () => ({ ok: true, message: ACCOUNT_RECOVERY_MESSAGE });
const failure = (code, error) => ({ ok: false, code, ...(error ? { error } : {}) });
class RecoveryDenied extends Error {}
const validDate = value => value instanceof Date && Number.isFinite(+value);
const sameIdentity = (a, b) => Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));

// Recovery does not activate any product or create a sign-in session.
export function accountRecoveryMode(env, now = new Date()) {
  const preview = readPrivatePreviewPolicy(env);
  if (!preview.valid || !validDate(now)) return "DISABLED";
  if (!preview.enabled) return "ORDINARY";
  return readPrivatePreviewRecoveryPolicy(env, now).enabled ? "PREVIEW" : "DISABLED";
}
function identity(user, env, now) {
  const mode = accountRecoveryMode(env, now);
  if (mode === "PREVIEW") return privatePreviewRecoveryIdentity(user, env, now);
  if (mode !== "ORDINARY" || !accountAllowsPasswordRecovery(user) || user.memberships?.length > 1000) return null;
  return { userId: user.id, organisationId: passwordRecoveryOrganisationId(user), memberId: null };
}
async function lockedUser(tx, id) {
  const rows = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length !== 1) throw new RecoveryDenied();
  // Lock the exact membership rows and policy rows before loading authority.
  // Serializable predicate reads also detect concurrent policy insertion.
  await tx.$queryRaw`SELECT "id" FROM "OrganisationMember" WHERE "userId" = ${id} ORDER BY "id" FOR SHARE`;
  await tx.$queryRaw`SELECT p."organisationId" FROM "EnterpriseSecurityPolicy" p
    JOIN "OrganisationMember" m ON m."organisationId" = p."organisationId"
    WHERE m."userId" = ${id} ORDER BY p."organisationId" FOR SHARE OF p`;
  return tx.user.findUnique({ where: { id }, select: recoveryUserSelect });
}

export function createAccountRecoveryService({ db, env, sendEmail, clock = () => new Date(),
  hashPassword = password => bcrypt.hash(password, 12), comparePassword = bcrypt.compare,
  log = () => {} }) {
  async function invalidate(id) {
    await db.passwordResetToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: clock() } });
  }
  return {
    async request(input, { requestUrl, requestId } = {}) {
      if (accountRecoveryMode(env, clock()) === "DISABLED") return failure("FEATURE_DISABLED");
      let email;
      try { email = normalizeRecoveryEmail(input?.email); } catch { return failure("INVALID_REQUEST"); }
      // Global delivery readiness is checked before looking up an address, so
      // unavailable delivery cannot reveal which accounts are registered.
      if (!accountRecoveryEmailConfig(env).configured) return failure("DELIVERY_UNAVAILABLE");
      let saved;
      try {
        const candidate = await db.user.findUnique({ where: { email }, select: recoveryUserSelect });
        const initial = identity(candidate, env, clock());
        if (!initial) { createAccountRecoveryToken(clock()); return accepted(); }
        saved = await runSerializableTransaction(db, async tx => {
          const user = await lockedUser(tx, candidate.id), now = clock();
          const current = identity(user, env, now);
          if (user?.email !== email || !sameIdentity(initial, current)) throw new RecoveryDenied();
          const generated = createAccountRecoveryToken(now);
          if (accountRecoveryMode(env, now) === "PREVIEW") {
            generated.expiresAt = new Date(Math.min(+generated.expiresAt, +readPrivatePreviewRecoveryPolicy(env, now).expiresAt));
          }
          await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
          const token = await tx.passwordResetToken.create({ data: { userId: user.id,
            tokenHash: generated.tokenHash, expiresAt: generated.expiresAt } });
          await tx.auditLog.create({ data: { organisationId: current.organisationId, actorUserId: user.id,
            action: "ACCOUNT_RECOVERY_REQUESTED", entityType: "PasswordResetToken", entityId: token.id,
            details: { expiresAt: generated.expiresAt, requestId } } });
          const finished = clock();
          if (!validDate(finished) || finished < now || finished >= generated.expiresAt ||
            !sameIdentity(current, identity(user, env, finished))) throw new RecoveryDenied();
          return { id: token.id, user, identity: current, generated };
        });
        if (!sameIdentity(saved.identity, identity(saved.user, env, clock()))) throw new RecoveryDenied();
        const origin = resolveRecoveryOrigin(requestUrl, env);
        const delivery = await sendEmail({ env, recovery: { recipientEmail: email,
          resetUrl: `${origin}/reset-password#token=${saved.generated.token}`,
          tokenId: saved.id, expiresAt: saved.generated.expiresAt } });
        if (delivery?.configured !== true || delivery?.delivered !== true) throw new Error("DELIVERY_FAILED");
        log("ACCOUNT_RECOVERY_PROVIDER_ACCEPTED");
        return accepted();
      } catch {
        if (saved?.id) await invalidate(saved.id).catch(() => log("ACCOUNT_RECOVERY_INVALIDATION_FAILED"));
        log("ACCOUNT_RECOVERY_REQUEST_UNAVAILABLE");
        // Provider/identity-specific failures must not enumerate accounts.
        return accepted();
      }
    },
    async reset(input, { requestId } = {}) {
      if (accountRecoveryMode(env, clock()) === "DISABLED") return failure("FEATURE_DISABLED");
      const validation = validateRecoveryPassword(input);
      if (!validation.ok) return failure("INVALID_REQUEST", validation.error);
      let tokenHash;
      try { tokenHash = hashAccountRecoveryToken(input?.token); } catch { return failure("INVALID_LINK"); }
      try {
        const recovery = await db.passwordResetToken.findUnique({ where: { tokenHash } });
        const before = clock();
        if (!recovery || recovery.usedAt || !validDate(before) || recovery.expiresAt <= before) return failure("INVALID_LINK");
        const user = await db.user.findUnique({ where: { id: recovery.userId }, select: recoveryUserSelect });
        const initial = identity(user, env, before);
        if (!initial) return failure("INVALID_LINK");
        if (await comparePassword(validation.password, user.passwordHash)) {
          return failure("INVALID_REQUEST", "Choose a password that is different from your current password.");
        }
        const passwordHash = await hashPassword(validation.password);
        await runSerializableTransaction(db, async tx => {
          const currentUser = await lockedUser(tx, user.id), now = clock();
          const current = identity(currentUser, env, now);
          if (!sameIdentity(initial, current) || currentUser?.email !== user.email ||
              currentUser?.passwordHash !== user.passwordHash || now < before) throw new RecoveryDenied();
          // Use fresh time AFTER password hashing and lock acquisition.
          const claimed = await tx.passwordResetToken.updateMany({ where: { id: recovery.id, userId: user.id,
            tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
          if (claimed.count !== 1) throw new RecoveryDenied();
          await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
          const revoked = await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
          await tx.passwordResetToken.updateMany({ where: { userId: user.id, id: { not: recovery.id }, usedAt: null }, data: { usedAt: now } });
          await tx.auditLog.create({ data: { organisationId: current.organisationId, actorUserId: user.id,
            action: "ACCOUNT_RECOVERY_COMPLETED", entityType: "User", entityId: user.id,
            details: { sessionsRevoked: revoked.count, requestId } } });
          const finished = clock();
          if (!validDate(finished) || finished < now || finished >= recovery.expiresAt ||
              !sameIdentity(current, identity(currentUser, env, finished))) throw new RecoveryDenied();
        });
        const preview = readPrivatePreviewPolicy(env).enabled;
        const destination = !preview ? "/login?password-reset=1" :
          readPilotPreviewPolicy(env).enabled ? "/rewards/pilot-sign-in?password-reset=1" : null;
        return { ok: true, message: destination ? "Your password has been reset and all previous sessions have been signed out." :
          "Your password has been reset and all previous sessions have been signed out. Private pilot access is currently closed; your administrator can arrange your next test.", destination };
      } catch (error) {
        log("ACCOUNT_RECOVERY_RESET_UNAVAILABLE");
        return failure(error instanceof RecoveryDenied ? "INVALID_LINK" : "UNAVAILABLE");
      }
    }
  };
}
