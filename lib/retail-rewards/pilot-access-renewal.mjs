import { createHash } from "node:crypto";
import { rewardIdSchema } from "./contracts.mjs";
import { canonicalEmailSchema, readShopperAuthPolicy } from "./shopper-auth-contracts.mjs";
import { readPilotPreviewPolicy } from "./pilot-preview-policy.mjs";
import { resolveRewardsEntitlements } from "./entitlements.mjs";

export const PILOT_RENEWAL_MAX_MS = 2 * 60 * 60 * 1000;
const finite = value => value instanceof Date && Number.isFinite(value.getTime());
const id = value => rewardIdSchema.safeParse(value).success;
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function requireRenewalPolicy(env, organisationId, abort) {
  const preview = readPilotPreviewPolicy(env);
  if (!readShopperAuthPolicy(env).enabled || !preview.enabled) abort("FEATURE_DISABLED");
  if (!preview.organisationIds.includes(organisationId)) abort("FORBIDDEN");
}

/** Exact existing-record renewal only. No identity, token, credential, quota,
 * programme, plan, audio or device is created or reset here. */
export function createPilotAccessRenewal({ env, abort, organisationState, nowAt }) {
  async function snapshot(tx, organisationId, shopperId, now, lock = false) {
    requireRenewalPolicy(env, organisationId, abort);
    if (lock) {
      const rows = await tx.$queryRaw`SELECT "id" FROM "RewardShopper" WHERE "id" = ${shopperId} FOR UPDATE`;
      const members = await tx.$queryRaw`SELECT "id" FROM "RewardShopperMembership" WHERE "shopperId" = ${shopperId} FOR UPDATE`;
      const invites = await tx.$queryRaw`SELECT "id" FROM "RewardShopperInvitation" WHERE "shopperId" = ${shopperId} FOR UPDATE`;
      if (rows.length !== 1 || rows[0].id !== shopperId || members.length !== 1 || invites.length !== 1) abort("INVITATION_UNAVAILABLE");
    }
    const state = await organisationState(tx, organisationId);
    const [setup, enrollment, shopper, membership, invitation, grantRow, programRow] = await Promise.all([
      tx.rewardShopperSetup.findUnique({ where: { shopperId } }),
      tx.rewardPilotShopperEnrollment.findUnique({ where: { shopperId } }),
      tx.rewardShopper.findUnique({ where: { id: shopperId } }),
      tx.rewardShopperMembership.findUnique({ where: { shopperId } }),
      tx.rewardShopperInvitation.findUnique({ where: { shopperId } }),
      tx.rewardEntitlementGrant.findUnique({ where: { organisationId } }),
      tx.rewardProgram.findUnique({ where: { organisationId } })
    ]);
    const { grant, program } = state;
    const email = canonicalEmailSchema.safeParse(setup?.emailCanonical);
    if (!setup || setup.shopperId !== shopperId || setup.organisationId !== organisationId || !id(setup.createdByUserId) ||
      !finite(setup.createdAt) || setup.createdAt > now || !email.success || email.data !== setup.emailCanonical ||
      !enrollment || enrollment.shopperId !== shopperId || enrollment.organisationId !== organisationId ||
      !id(enrollment.createdByUserId) || !finite(enrollment.createdAt) || enrollment.createdAt < setup.createdAt || enrollment.createdAt > now ||
      !shopper || shopper.id !== shopperId || shopper.status !== "DISABLED" || shopper.authVersion !== 1 || !finite(shopper.updatedAt) ||
      typeof shopper.displayName !== "string" || !shopper.displayName.trim() || shopper.displayName.length > 80 ||
      !shopper.displayName.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(shopper.displayName) ||
      !membership || !id(membership.id) || membership.shopperId !== shopperId || membership.status !== "ACTIVE" ||
      membership.source !== "MANUAL_INTERNAL" || membership.revokedAt !== null || !finite(membership.startsAt) ||
      !finite(membership.expiresAt) || membership.startsAt >= membership.expiresAt || membership.startsAt > now || !finite(membership.updatedAt) ||
      !Number.isSafeInteger(membership.version) || membership.version < 1 || membership.version > 2147483647 ||
      !invitation || !id(invitation.id) || invitation.shopperId !== shopperId || invitation.emailCanonical !== email.data ||
      invitation.authVersion !== 1 || invitation.acceptedAt !== null || !finite(invitation.revokedAt) || invitation.revokedAt > now ||
      !finite(invitation.createdAt) || !finite(invitation.expiresAt) || invitation.createdAt >= invitation.expiresAt || invitation.createdAt > invitation.revokedAt ||
      !/^[a-f0-9]{64}$/.test(invitation.tokenHash) ||
      !grant || !grantRow || grantRow.id !== grant.id || grant.status !== "TRIAL" || grant.source !== "MANUAL_INTERNAL" ||
      grant.revokedAt !== null || grant.startsAt > now || !finite(grantRow.updatedAt) || grantRow.limitsVersion !== 1 ||
      !program || !programRow || programRow.id !== program.id || program.status !== "ACTIVE" || program.networkOptIn !== true || !finite(programRow.updatedAt)) abort("INVITATION_UNAVAILABLE");
    // Extending a tenant grant must not silently revive a different pilot
    // shopper, staff authority or still-live offer outside this reviewed scope.
    const insensitiveEmail = { equals: email.data, mode: "insensitive" };
    const [users, credentials, invitations, setups, provenance, inviteAudit, enrollments, staff, liveOffers, ...counts] = await Promise.all([
      tx.user.findMany({ where: { email: insensitiveEmail }, select: { id: true }, take: 2 }),
      tx.rewardShopperCredential.findMany({ where: { emailCanonical: insensitiveEmail }, select: { shopperId: true }, take: 2 }),
      tx.rewardShopperInvitation.findMany({ where: { emailCanonical: insensitiveEmail }, select: { id: true, shopperId: true }, take: 2 }),
      tx.rewardShopperSetup.findMany({ where: { emailCanonical: insensitiveEmail }, select: { shopperId: true }, take: 2 }),
      tx.auditLog.findMany({ where: { organisationId, action: "DORMANT_SHOPPER_PREPARED", entityType: "RewardShopper", entityId: shopperId }, select: { actorUserId: true, details: true }, take: 2 }),
      tx.rewardPilotAuditEvent.findMany({ where: { organisationId, action: "SHOPPER_INVITED", targetType: "SHOPPER", targetId: shopperId }, select: { actorUserId: true, createdAt: true }, take: 2 }),
      tx.rewardPilotShopperEnrollment.findMany({ where: { organisationId }, select: { shopperId: true }, take: 2 }),
      tx.rewardStaffGrant.count({ where: { organisationId } }),
      tx.rewardOffer.count({ where: { organisationId, state: "PUBLISHED", publishedEndsAt: { gt: now } } }),
      ...["rewardShopperCredential", "rewardShopperSession", "rewardClaim", "rewardRedemption"].map(model => tx[model].count({ where: { shopperId } }))
    ]);
    if (users.length || credentials.length || invitations.length !== 1 || invitations[0].id !== invitation.id || invitations[0].shopperId !== shopperId ||
      setups.length !== 1 || setups[0].shopperId !== shopperId || provenance.length !== 1 || provenance[0].actorUserId !== setup.createdByUserId ||
      provenance[0].details?.shopperId !== shopperId || provenance[0].details.status !== "DISABLED" || provenance[0].details.accessGranted !== false ||
      inviteAudit.length !== 1 || inviteAudit[0].actorUserId !== enrollment.createdByUserId || !finite(inviteAudit[0].createdAt) ||
      inviteAudit[0].createdAt.getTime() !== enrollment.createdAt.getTime() || enrollments.length !== 1 || enrollments[0].shopperId !== shopperId ||
      staff !== 0 || liveOffers !== 0 || counts.some(n => n !== 0)) abort("INVITATION_UNAVAILABLE");
    const fingerprint = hash({ organisationId, subscription: state.subscription, program: programRow, grant: grantRow,
      setup, enrollment, shopper, membership, invitation });
    return { state, setup, enrollment, shopper, membership, invitation, fingerprint };
  }
  function eligible(value, organisationId, now, expiresAt) {
    const projected = { ...value.state.grant, expiresAt };
    const program = value.state.program;
    if (!resolveRewardsEntitlements({ organisationId, subscription: value.state.subscription, grant: projected,
      program: { id: program.id, organisationId, status: program.status }, action: "READ", now }).allowed) abort("NOT_ENTITLED");
  }
  function expired(value, now) {
    if (value.state.grant.expiresAt > now || value.membership.expiresAt > now) abort("CONFLICT");
  }
  function result(value, input) {
    return { ok: true, shopperId: input.shopperId, programId: value.state.program.id, grantId: value.state.grant.id,
      membershipId: value.membership.id, expiresAt: input.expiresAt, membershipVersion: value.membership.version, requestId: input.requestId };
  }
  return Object.freeze({
    async review(tx, input, now) {
      const value = await snapshot(tx, input.organisationId, input.shopperId, now);
      expired(value, now); eligible(value, input.organisationId, now, new Date(+now + 1));
      return { ok: true, organisationId: input.organisationId, shopperId: input.shopperId, email: value.setup.emailCanonical,
        displayName: value.shopper.displayName, programId: value.state.program.id,
        grant: { id: value.state.grant.id, tier: value.state.grant.tier, expiresAt: value.state.grant.expiresAt.toISOString(), limits: value.state.grant.limits },
        membership: { id: value.membership.id, expiresAt: value.membership.expiresAt.toISOString(), version: value.membership.version },
        invitation: { id: value.invitation.id, status: "REVOKED" }, expectedState: value.fingerprint, checkedAt: now.toISOString() };
    },
    async renew(tx, input, identity, now) {
      const expiresAt = new Date(input.expiresAt);
      if (expiresAt <= now || expiresAt - now > PILOT_RENEWAL_MAX_MS) abort("INVALID_REQUEST");
      let value = await snapshot(tx, input.organisationId, input.shopperId, now, true);
      const requestHash = hash(input);
      const attempts = await tx.rewardPilotAuditEvent.findMany({ where: { organisationId: input.organisationId,
        action: "PILOT_ACCESS_RENEWED", requestId: input.requestId }, take: 2 });
      if (attempts.length) {
        const previous = attempts[0];
        if (attempts.length !== 1 || previous.actorUserId !== identity.userId || previous.targetType !== "PROGRAM" ||
          previous.targetId !== value.state.program.id || previous.metadataJson?.requestHash !== requestHash ||
          previous.metadataJson.afterStateHash !== value.fingerprint || previous.metadataJson.expiresAt !== input.expiresAt ||
          value.state.grant.expiresAt.toISOString() !== input.expiresAt || value.membership.expiresAt.toISOString() !== input.expiresAt) abort("CONFLICT");
        eligible(value, input.organisationId, now, expiresAt);
        return result(value, input);
      }
      expired(value, now);
      if (value.membership.version >= 2147483647) abort("CONFLICT");
      if (value.fingerprint !== input.expectedState) abort("CONFLICT");
      eligible(value, input.organisationId, now, expiresAt);
      const previousGrantExpiry = value.state.grant.expiresAt.toISOString(), previousMembershipExpiry = value.membership.expiresAt.toISOString();
      await tx.rewardEntitlementGrant.update({ where: { id: value.state.grant.id }, data: { expiresAt } });
      await tx.rewardShopperMembership.update({ where: { id: value.membership.id }, data: { expiresAt, version: value.membership.version + 1 } });
      const checked = nowAt(now);
      if (expiresAt <= checked) abort("INVALID_REQUEST");
      value = await snapshot(tx, input.organisationId, input.shopperId, checked);
      eligible(value, input.organisationId, checked, expiresAt);
      await tx.rewardPilotAuditEvent.create({ data: { organisationId: input.organisationId, actorUserId: identity.userId,
        action: "PILOT_ACCESS_RENEWED", targetType: "PROGRAM", targetId: value.state.program.id, requestId: input.requestId,
        metadataJson: { status: "RENEWED", expiresAt: input.expiresAt, previousGrantExpiry, previousMembershipExpiry,
          requestHash, afterStateHash: value.fingerprint, shopperId: input.shopperId, grantId: value.state.grant.id,
          membershipId: value.membership.id, membershipVersion: value.membership.version }, createdAt: checked } });
      return result(value, input);
    }
  });
}
