import { createHash } from "node:crypto";
import { assertPreviewTesterState } from "./private-preview-account-policy.mjs";
import { createSubscriberTestPlanSnapshot, readSubscriberTestPlan } from "./subscriber-test-plan.mjs";
import { isRetailSubscriberContext, isRetailSubscriberSession, RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "./retail-subscriber-access.mjs";
import { readPrivatePreviewBody } from "./private-preview-request.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

const USER_INCLUDE = { privatePreviewAccess: true, memberships: { include: { organisation: { include: {
  subscription: { include: { plan: true, billingContract: true } }, enterpriseSecurityPolicy: true
} } } } };
const MESSAGES = Object.freeze({
  ACCESS_DENIED: [403, "Retail tier testing is unavailable for this account."],
  REQUEST_INVALID: [400, "Choose a Retail test tier and confirm the change."],
  ORIGIN_INVALID: [403, "This request is not permitted."],
  PLAN_UNAVAILABLE: [409, "The selected Retail tier is unavailable. Refresh the choices and try again."],
  PLANS_UNAVAILABLE: [503, "The five Retail test tiers could not be verified. Please try again later."],
  SELECTION_CHANGED: [409, "The selected test tier changed in another tab. Refresh before choosing again."],
  USAGE_UNAVAILABLE: [503, "Current Retail usage could not be verified. Please try again later."],
  REQUEST_FAILED: [503, "The Retail test tier could not be saved or verified. Refresh before trying again."]
});
const fail = code => { throw Object.assign(new Error(`RETAIL_TEST_TIER_${code}`), { code: `RETAIL_TEST_TIER_${code}` }); };
const time = now => now instanceof Date && Number.isFinite(now.getTime());
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const revision = snapshot => snapshot == null ? null : createHash("sha256").update(canonical(snapshot)).digest("hex");

export function retailTestTierPublicError(error) {
  const key = typeof error?.code === "string" ? error.code.replace(/^RETAIL_TEST_TIER_/, "") : "REQUEST_FAILED";
  const known = Object.hasOwn(MESSAGES, key) ? key : "REQUEST_FAILED";
  const [status, message] = MESSAGES[known];
  return { status, body: { error: message, code: `RETAIL_TEST_TIER_${known}` } };
}

export function validateRetailTestTierInput(input) {
  if (!input || Array.isArray(input) || typeof input !== "object" ||
    Object.keys(input).some(key => !["planCode", "confirmed", "expectedRevision"].includes(key)) ||
    !Object.hasOwn(input, "planCode") || typeof input.planCode !== "string" || !/^[A-Z0-9_]{1,64}$/.test(input.planCode) ||
    !Object.hasOwn(input, "confirmed") || input.confirmed !== true ||
    (Object.hasOwn(input, "expectedRevision") && input.expectedRevision !== null &&
      (typeof input.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedRevision)))) fail("REQUEST_INVALID");
  return input;
}

export function validateRetailTestTierQuery(request) {
  if ([...new URL(request.url).searchParams.keys()].length) fail("REQUEST_INVALID");
}

export async function readRetailTestTierCommand(request) {
  validateRetailTestTierQuery(request);
  if (request.headers.get("origin") !== "https://www.ruvanas.com" || request.headers.get("sec-fetch-site") === "cross-site") fail("ORIGIN_INVALID");
  let input;
  try { input = await readPrivatePreviewBody(request, ["planCode", "confirmed", "expectedRevision"]); }
  catch { fail("REQUEST_INVALID"); }
  return validateRetailTestTierInput(input);
}

async function principal(db, context, now) {
  if (!time(now) || !isRetailSubscriberContext(context, now) || context.user.privatePreviewAccess?.subscriberTestingEnabled !== true) fail("ACCESS_DENIED");
  const [user, session] = await Promise.all([
    db.user.findUnique({ where: { id: context.session.userId }, include: USER_INCLUDE }),
    db.session.findUnique({ where: { id: context.session.id } })
  ]);
  if (!user || !session || user.privatePreviewAccess?.subscriberTestingEnabled !== true ||
    !isRetailSubscriberSession({ ...session, user }, now) ||
    session.id !== context.session.id || session.userId !== context.user.id ||
    await db.organisationMember.count({ where: { organisationId: ORG } }) !== 1) fail("ACCESS_DENIED");
  let state;
  try { state = assertPreviewTesterState(user, { now, requirePassword: session.authMethod === "PREVIEW_PASSWORD" }); }
  catch { fail("ACCESS_DENIED"); }
  return { user, subscription: state.subscription, grant: state.grant, pillars: state.pillars };
}

function snapshotFor(scope, plan, now) {
  return createSubscriberTestPlanSnapshot({ plan, userId: scope.user.id, organisationId: ORG,
    basePlanId: scope.subscription.planId, pillars: scope.pillars, expiresAt: scope.grant.expiresAt, now });
}

async function availablePlans(db, scope, now) {
  const plans = await db.plan.findMany({ where: { active: true, publiclyAvailable: true, productFamily: "RETAIL" },
    orderBy: [{ tierNumber: "asc" }, { code: "asc" }], take: 6 });
  if (plans.length !== 5 || new Set(plans.map(plan => plan.tierNumber)).size !== 5 ||
      new Set(plans.map(plan => plan.code)).size !== 5) fail("PLANS_UNAVAILABLE");
  try {
    for (const plan of plans) {
      if (plan.productFamily !== "RETAIL" || !/^[A-Z0-9_]{1,64}$/.test(plan.code)) fail("PLANS_UNAVAILABLE");
      snapshotFor(scope, plan, now);
    }
  } catch { fail("PLANS_UNAVAILABLE"); }
  return plans;
}

async function readUsage(db) {
  const [locations, players, storage] = await Promise.all([
    db.location.count({ where: { organisationId: ORG, status: { not: "CLOSED" }, correctionsFacility: { is: null } } }),
    db.player.count({ where: { organisationId: ORG, status: { not: "DISABLED" } } }),
    db.mediaAsset.aggregate({ where: { organisationId: ORG, status: { in: ["UPLOADING", "PROCESSING", "READY"] } }, _sum: { sizeBytes: true } })
  ]);
  const storageBytes = Number(storage?._sum?.sizeBytes ?? 0);
  if (![locations, players, storageBytes].every(value => Number.isSafeInteger(value) && value >= 0)) fail("USAGE_UNAVAILABLE");
  return { locations, players, storageBytes };
}

function planSummary(plan) {
  return plan ? { code: plan.code, name: plan.name, tierNumber: plan.tierNumber,
    limits: { locations: plan.stationLimit, players: plan.stationLimit, storageGb: plan.storageLimitGb, bitrateKbps: plan.maxBitrateKbps },
    catalogueLevel: plan.licensedMusicCatalogueLevel, promoUploadEnabled: plan.promoUploadEnabled,
    digitalDisplaysEnabled: false, monthlyPriceCents: 0 } : null;
}

function result(scope, plans, usage, now) {
  const selected = readSubscriberTestPlan(scope.subscription, now);
  // The projection also binds to the persisted actor and exact invitation.
  const raw = scope.subscription.subscriberTestPlanSnapshot;
  const current = selected && raw.userId === scope.user.id && raw.organisationId === ORG &&
    raw.expiresAt === scope.grant.expiresAt.toISOString() ? selected : null;
  const warnings = [];
  if (raw && !current) warnings.push("The previous test selection is unavailable. Choose a current Retail tier to continue testing.");
  if (current) {
    if (usage.locations > current.stationLimit) warnings.push("Existing shops exceed this tier’s location limit. They are kept; adding shops is restricted until usage fits the selected tier.");
    if (usage.players > current.stationLimit) warnings.push("Existing players exceed this tier’s player limit. They are kept; adding players is restricted until usage fits the selected tier.");
    if (usage.storageBytes > current.storageLimitGb * 1024 ** 3) warnings.push("Existing uploads exceed this tier’s storage limit. Files are kept; new uploads remain subject to the storage allowance.");
  }
  return { ok: true, freeTest: true, revision: revision(raw), currentPlan: planSummary(current),
    plans: plans.map(planSummary), usage, warnings, streamUnchanged: true };
}

export async function getRetailTestTiers(db, { context, now = new Date() } = {}) {
  return runSerializableTransaction(db, async tx => {
    const scope = await principal(tx, context, now);
    const [plans, usage] = await Promise.all([availablePlans(tx, scope, now), readUsage(tx)]);
    return result(scope, plans, usage, now);
  });
}

export async function selectRetailTestTier(db, { context, input, now = new Date() } = {}) {
  validateRetailTestTierInput(input);
  return runSerializableTransaction(db, async tx => {
    const scope = await principal(tx, context, now);
    if (Object.hasOwn(input, "expectedRevision") && input.expectedRevision !== revision(scope.subscription.subscriberTestPlanSnapshot)) fail("SELECTION_CHANGED");
    const plans = await availablePlans(tx, scope, now), plan = plans.find(row => row.code === input.planCode);
    if (!plan) fail("PLAN_UNAVAILABLE");
    const usage = await readUsage(tx), selected = snapshotFor(scope, plan, now);
    const previous = scope.subscription.subscriberTestPlanSnapshot;
    const previousPlanCode = readSubscriberTestPlan(scope.subscription, now)?.code || null;
    // The same plan with unchanged features is a no-op; a database plan edit
    // creates a new snapshot, but never edits the public plan itself.
    const same = previous && canonical({ ...previous, issuedAt: selected.issuedAt }) === canonical(selected);
    if (!same) {
      await tx.subscription.update({ where: { id: scope.subscription.id }, data: { subscriberTestPlanSnapshot: selected } });
      await tx.auditLog.create({ data: { organisationId: ORG, actorUserId: scope.user.id,
        action: "RETAIL_SUBSCRIBER_TEST_TIER_SELECTED", entityType: "Subscription", entityId: scope.subscription.id,
        details: { planCode: plan.code, planId: plan.id, previousPlanCode,
          previousRevision: revision(previous), revision: revision(selected), freeTest: true,
          billingChanged: false, sourceChanged: false, dataDeleted: false, expiresAt: scope.grant.expiresAt.toISOString() } } });
      scope.subscription = { ...scope.subscription, subscriberTestPlanSnapshot: selected };
    }
    return { ...result(scope, plans, usage, now), changed: !same };
  });
}
