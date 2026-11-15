import { createHash, createHmac, randomUUID } from "node:crypto";
import { readReversalPolicy, reversalInspectSchema, reversalRequestSchema, reversalQuerySchema, REVERSAL_REASONS, REVERSAL_WINDOW_MS } from "./reversal-contracts.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { offerTermsSchema } from "./offer-contracts.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { rewardsDenied } from "./errors.mjs";
import { runSerializableTransaction, isRetryableTransactionError } from "../transaction-retry.mjs";

const PAGE = 25;
const receiptInclude = Object.freeze({ reversal: true, claim: { include: {
  publishedSnapshot: { select: { organisationId: true, offerId: true, revision: true, terms: true } }
} } });
class ReversalAbort extends Error { constructor(result) { super(result.code); this.result = result; } }
const abort = code => { throw new ReversalAbort(rewardsDenied(code)); };
const finiteDate = value => value instanceof Date && Number.isFinite(value.getTime());
const iso = value => { if (!finiteDate(value)) abort("UNAVAILABLE"); return value.toISOString(); };
const allowed = result => { if (!result?.ok) abort(result?.code); return result; };
const sameAuthority = (a, b) => a.organisationId === b.organisationId && a.userId === b.userId &&
  a.organisationMemberId === b.organisationMemberId && a.authority.sessionId === b.authority.sessionId &&
  a.authority.subscriptionId === b.authority.subscriptionId && a.authority.role === b.authority.role;

function requestKey(value, secret) {
  if (typeof secret !== "string" || secret.length < 32) abort("UNAVAILABLE");
  return createHmac("sha256", secret).update(`ruvanas-rewards-reversal-request:v1:${value}`).digest("hex");
}
function receiptView(row) {
  const claim = row?.claim, snapshot = claim?.publishedSnapshot;
  if (!row || !claim || claim.id !== row.claimId || claim.organisationId !== row.organisationId || claim.offerId !== row.offerId ||
    claim.shopperId !== row.shopperId || claim.locationId !== row.locationId || !snapshot || snapshot.organisationId !== row.organisationId ||
    snapshot.offerId !== row.offerId || snapshot.revision !== claim.revision || !finiteDate(row.occurredAt)) abort("REDEMPTION_UNAVAILABLE");
  const terms = offerTermsSchema.safeParse(snapshot.terms);
  if (!terms.success || !terms.data.locationIds.includes(row.locationId)) abort("REDEMPTION_UNAVAILABLE");
  const correction = row.reversal;
  if (correction && (correction.redemptionId !== row.id || correction.organisationId !== row.organisationId ||
    !REVERSAL_REASONS.includes(correction.reason) || !finiteDate(correction.occurredAt) || correction.occurredAt < row.occurredAt)) abort("REDEMPTION_UNAVAILABLE");
  return { id: row.id, redeemedAt: iso(row.occurredAt), shopName: claim.publicShopName, offerTitle: terms.data.title,
    revision: claim.revision, currency: row.currency, eligibleSpendMinor: row.eligibleSpendMinor, discountMinor: row.discountMinor,
    reversal: correction ? { id: correction.id, reversedAt: iso(correction.occurredAt), reason: correction.reason } : null };
}
function deadlineFor(row) {
  if (!finiteDate(row?.occurredAt)) abort("REDEMPTION_UNAVAILABLE");
  const deadline = new Date(row.occurredAt.getTime() + REVERSAL_WINDOW_MS);
  if (!finiteDate(deadline)) abort("REDEMPTION_UNAVAILABLE");
  return deadline;
}
function requireWindow(row, now) {
  if (row.occurredAt > now) abort("REDEMPTION_UNAVAILABLE");
  if (now >= deadlineFor(row)) abort("REVERSAL_WINDOW_CLOSED");
}

/** Local/default-off correction ledger. Original receipts and claims never change.
 * Existing authority rows are locked through commit: a revocation committed before
 * its lock forces a serializable retry; a later revocation follows the correction.
 * Programme locking is shared with checkout, so restored offer capacity cannot be
 * spent twice. Monthly service usage deliberately remains gross in checkout. */
export function createRewardReversalService({ db, env = {}, loadContext, clock = () => new Date() } = {}) {
  const enabled = () => readReversalPolicy(env).enabled;
  function nowAt(earliest) {
    if (!enabled()) abort("FEATURE_DISABLED");
    const now = clock();
    if (!finiteDate(now) || (earliest && now < earliest)) abort("UNAVAILABLE");
    return new Date(now.getTime());
  }
  async function safely(operation) {
    if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
    try { return await operation(); }
    catch (error) { return error instanceof ReversalAbort ? error.result : rewardsDenied(isRetryableTransactionError(error) ? "CONFLICT" : "UNAVAILABLE"); }
  }
  async function guard(client, locationId, previous) {
    if (!enabled()) abort("FEATURE_DISABLED");
    if (typeof loadContext !== "function") abort("UNAUTHENTICATED");
    let context;
    const access = allowed(await requireRetailRewardsAccess({ action: "REVERSE", locationId }, {
      env, clock, loadContext: async () => { context = await loadContext(client); return context; }, ...createRewardsDatabaseAdapter(client) }));
    if (!["OWNER", "MANAGER"].includes(context?.membership?.role)) abort("FORBIDDEN");
    const current = { ...access, authority: { sessionId: context.session.id, subscriptionId: context.membership.organisation.subscription.id,
      role: context.membership.role } };
    if (previous && !sameAuthority(previous, current)) abort("FORBIDDEN");
    return current;
  }
  async function receipt(client, id, access) {
    const row = await client.rewardRedemption.findFirst({ where: { id, organisationId: access.organisationId, locationId: access.locationId }, include: receiptInclude });
    if (!row || row.id !== id || row.organisationId !== access.organisationId || row.locationId !== access.locationId) abort("REDEMPTION_UNAVAILABLE");
    receiptView(row); return row;
  }
  async function lockAuthority(tx, access, offerId, receiptId) {
    const programs = await tx.$queryRaw`SELECT "id" FROM "RewardProgram" WHERE "organisationId" = ${access.organisationId} FOR UPDATE`;
    if (!Array.isArray(programs) || programs.length !== 1) abort("REDEMPTION_UNAVAILABLE");
    const offers = await tx.$queryRaw`SELECT "id" FROM "RewardOffer" WHERE "organisationId" = ${access.organisationId} AND "id" = ${offerId} FOR UPDATE`;
    if (!Array.isArray(offers) || offers.length !== 1 || offers[0].id !== offerId) abort("REDEMPTION_UNAVAILABLE");
    const merchant = await tx.$queryRaw`SELECT sub."id" FROM "Subscription" sub
      JOIN "Plan" p ON p."id" = sub."planId"
      JOIN "RewardEntitlementGrant" g ON g."organisationId" = sub."organisationId" AND g."subscriptionId" = sub."id"
      WHERE sub."organisationId" = ${access.organisationId} FOR SHARE OF sub, p, g`;
    if (!Array.isArray(merchant) || merchant.length !== 1) abort("NOT_ENTITLED");
    await tx.$queryRaw`SELECT "id" FROM "BillingContract" WHERE "subscriptionId" = ${merchant[0].id} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "EnterpriseSecurityPolicy" WHERE "organisationId" = ${access.organisationId} FOR SHARE`;
    const staff = await tx.$queryRaw`SELECT s."id" FROM "Session" s
      JOIN "User" u ON u."id" = s."userId"
      JOIN "OrganisationMember" m ON m."userId" = u."id" AND m."id" = ${access.organisationMemberId}
      WHERE s."id" = ${access.authority.sessionId} AND s."activeOrganisationId" = ${access.organisationId}
        AND u."id" = ${access.userId} AND m."organisationId" = ${access.organisationId} FOR SHARE OF s, u, m`;
    if (!Array.isArray(staff) || staff.length !== 1) abort("FORBIDDEN");
    if (access.authority.role !== "OWNER") {
      const grants = await tx.$queryRaw`SELECT "id" FROM "RewardStaffGrant" WHERE "organisationId" = ${access.organisationId}
        AND "organisationMemberId" = ${access.organisationMemberId} ORDER BY "id" LIMIT 1001 FOR SHARE`;
      if (!Array.isArray(grants) || grants.length < 1 || grants.length > 1000) abort("FORBIDDEN");
    }
    const locations = await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${access.locationId} AND "organisationId" = ${access.organisationId} FOR SHARE`;
    if (!Array.isArray(locations) || locations.length !== 1) abort("LOCATION_UNAVAILABLE");
    const receipts = await tx.$queryRaw`SELECT "id" FROM "RewardRedemption" WHERE "id" = ${receiptId}
      AND "organisationId" = ${access.organisationId} AND "locationId" = ${access.locationId} FOR UPDATE`;
    if (!Array.isArray(receipts) || receipts.length !== 1 || receipts[0].id !== receiptId) abort("REDEMPTION_UNAVAILABLE");
  }
  async function replay(client, keyWhere, requestHash, values, initial, started) {
    const previous = await client.rewardRedemptionReversal.findUnique({ where: keyWhere });
    if (!previous) return null;
    if (previous.requestHash !== requestHash) abort("CONFLICT");
    if (previous.organisationId !== initial.organisationId || previous.actorOrganisationMemberId !== initial.organisationMemberId || previous.redemptionId !== values.redemptionId) abort("REDEMPTION_UNAVAILABLE");
    await guard(client, values.locationId, initial);
    const original = await receipt(client, values.redemptionId, initial);
    if (original.reversal?.id !== previous.id) abort("REDEMPTION_UNAVAILABLE");
    await guard(client, values.locationId, initial); nowAt(started);
    return { ok: true, receipt: receiptView(original) };
  }
  return Object.freeze({
    locations(input = {}) { return safely(async () => {
      const parsed = reversalQuerySchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      if (typeof loadContext !== "function") abort("UNAUTHENTICATED");
      const context = await loadContext(db), started = nowAt(), session = context?.session, member = context?.membership;
      if (!session || session.userId !== context.user?.id || !finiteDate(session.expiresAt) || session.expiresAt <= started || session.revokedAt !== null) abort("UNAUTHENTICATED");
      if (context.user.privatePreviewAccess != null || !member || member.userId !== session.userId || member.organisationId !== session.activeOrganisationId ||
        !["OWNER", "MANAGER"].includes(member.role) || !rewardIdSchema.safeParse(member.organisationId).success) abort("FORBIDDEN");
      const page = parsed.data.page || 1, rows = await db.location.findMany({ where: { organisationId: member.organisationId, status: "ACTIVE" },
        orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * PAGE, take: PAGE + 1, select: { id: true, name: true, organisationId: true } });
      const locations = [];
      for (const row of rows.slice(0, PAGE)) {
        if (row.organisationId !== member.organisationId) abort("UNAVAILABLE");
        try { const access = await guard(db, row.id); if (access.organisationId !== member.organisationId || access.userId !== session.userId) abort("FORBIDDEN");
          await guard(db, row.id, access); locations.push({ id: row.id, name: row.name }); }
        catch (error) { if (!(error instanceof ReversalAbort) || error.result.code !== "LOCATION_UNAVAILABLE") throw error; }
      }
      nowAt(started); return { ok: true, locations, page, hasMore: rows.length > PAGE };
    }); },
    inspect(input) { return safely(async () => {
      const parsed = reversalInspectSchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      const values = parsed.data, initial = await guard(db, values.locationId), started = nowAt();
      await receipt(db, values.redemptionId, initial); await guard(db, values.locationId, initial);
      const original = await receipt(db, values.redemptionId, initial), deadline = deadlineFor(original);
      await guard(db, values.locationId, initial); const now = nowAt(started);
      return { ok: true, receipt: receiptView(original), canReverse: !original.reversal && original.occurredAt <= now && now < deadline, deadline: iso(deadline) };
    }); },
    reverse(input) { return safely(async () => {
      const parsed = reversalRequestSchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      const values = parsed.data, initial = await guard(db, values.locationId), started = nowAt();
      const idempotencyKeyHash = requestKey(values.idempotencyKey, env.SESSION_SECRET);
      const requestHash = createHash("sha256").update(JSON.stringify([values.redemptionId, values.locationId, values.reason, true])).digest("hex");
      const keyWhere = { organisationId_actorOrganisationMemberId_idempotencyKeyHash: { organisationId: initial.organisationId,
        actorOrganisationMemberId: initial.organisationMemberId, idempotencyKeyHash } };
      const previous = await replay(db, keyWhere, requestHash, values, initial, started); if (previous) return previous;
      const candidate = await receipt(db, values.redemptionId, initial);
      return runSerializableTransaction(db, async tx => {
        await lockAuthority(tx, initial, candidate.offerId, candidate.id); await guard(tx, values.locationId, initial);
        const retried = await replay(tx, keyWhere, requestHash, values, initial, started); if (retried) return retried;
        const original = await receipt(tx, values.redemptionId, initial), now = nowAt(started);
        if (original.offerId !== candidate.offerId) abort("REDEMPTION_UNAVAILABLE");
        if (original.reversal) abort("ALREADY_REVERSED");
        requireWindow(original, now);
        const correction = await tx.rewardRedemptionReversal.create({ data: { id: randomUUID(), organisationId: initial.organisationId,
          redemptionId: original.id, actorUserId: initial.userId, actorOrganisationMemberId: initial.organisationMemberId,
          reason: values.reason, idempotencyKeyHash, requestHash, occurredAt: now } });
        await guard(tx, values.locationId, initial); requireWindow(original, nowAt(now));
        return { ok: true, receipt: receiptView({ ...original, reversal: correction }) };
      }, { maxAttempts: 3, retryDelayMs: 10 });
    }); }
  });
}
