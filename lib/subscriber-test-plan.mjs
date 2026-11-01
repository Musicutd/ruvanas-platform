import { assertPreviewTesterState, isPreviewTesterPlan, previewTesterOverrides } from "./private-preview-account-policy.mjs";

const KIND = "SUBSCRIBER_TEST_PLAN_V1";
const PRODUCTS = Object.freeze({ RETAIL: "retailRadioEnabled", SCHOOL: "schoolRadioEnabled",
  ONLINE: "onlineRadioEnabled", HEALTH: "healthRadioEnabled", FAITH: "faithRadioEnabled",
  ORGANISATIONS: "organisationsEnabled", CORRECTIONS: "correctionsRadioEnabled" });
const LIMITS = ["stationLimit", "storageLimitGb", "listenerLimit", "maxBitrateKbps"];
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 191;
const validDate = value => value instanceof Date && Number.isFinite(value.getTime());
const bindings = new WeakMap();
const RETAIL_ORGANISATION = "cmvmeq5880005lf2knwtw1b93";
const RETAIL_EMAIL = "retail@manuelchircop.com";

function validPlan(plan) {
  return Boolean(plan && id(plan.id) && text(plan.name) && text(plan.code) &&
    !plan.code.toUpperCase().startsWith("PRIVATE_PREVIEW_") && plan.active === true &&
    plan.publiclyAvailable === true && Object.hasOwn(PRODUCTS, plan.productFamily) &&
    Number.isInteger(plan.tierNumber) && plan.tierNumber >= 1 && plan.tierNumber <= 5 &&
    LIMITS.every(key => Number.isSafeInteger(plan[key]) && plan[key] >= (key === "storageLimitGb" ? 0 : 1)) &&
    (plan.studioExternalDestinationLimit === null ||
      Number.isSafeInteger(plan.studioExternalDestinationLimit) && plan.studioExternalDestinationLimit >= 0) &&
    ["NONE", "FOCUSED", "PROFESSIONAL", "PREMIUM"].includes(plan.licensedMusicCatalogueLevel) &&
    ["includesRuvanasCatalogue", "promoUploadEnabled", ...Object.values(PRODUCTS)].every(key => typeof plan[key] === "boolean") &&
    Object.entries(PRODUCTS).every(([product, flag]) => plan[flag] === (product === plan.productFamily)));
}

/** Called only with an authorised tester-selected, database-loaded public plan. This is a
 * feature snapshot, never a billing contract, payment or output approval. */
export function createSubscriberTestPlanSnapshot({ plan, userId, organisationId, basePlanId,
  pillars, expiresAt, now = new Date() } = {}) {
  const copied = plan ? { ...plan, studioExternalDestinationLimit: plan.studioExternalDestinationLimit ?? null } : null;
  if (!validPlan(copied) || !id(userId) || !id(organisationId) || !id(basePlanId) ||
    !validDate(now) || !validDate(expiresAt) || expiresAt <= now ||
    !Array.isArray(pillars) || pillars.length !== 1 || pillars[0] !== copied.productFamily) {
    throw new Error("Choose an active plan for this test profile's assigned product.");
  }
  const features = { id: copied.id, name: copied.name, code: copied.code,
    active: true, publiclyAvailable: true, tierNumber: copied.tierNumber, productFamily: copied.productFamily,
    monthlyPriceCents: 0, studioExternalDestinationLimit: copied.studioExternalDestinationLimit,
    includesRuvanasCatalogue: copied.includesRuvanasCatalogue,
    licensedMusicCatalogueLevel: copied.licensedMusicCatalogueLevel, promoUploadEnabled: copied.promoUploadEnabled,
    ...Object.fromEntries(LIMITS.map(key => [key, copied[key]])),
    ...previewTesterOverrides(pillars),
    // These remain separately authorised product actions, not plan upgrades.
    digitalSignageEnabled: false, retailMediaEnabled: false, schoolPublicPublishingEnabled: false };
  return { kind: KIND, userId, organisationId, basePlanId, issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(), pillars: [...pillars], plan: features };
}

/** Safe stored-data inspection for the tier selector. This alone grants no
 * effective entitlements: resolution below requires a current tester binding. */
export function readSubscriberTestPlan(subscription, now = new Date()) {
  const snapshot = subscription?.subscriberTestPlanSnapshot;
  if (!snapshot || snapshot.kind !== KIND || !validDate(now) ||
    !isPreviewTesterPlan(subscription?.plan) || subscription.status !== "TRIAL" ||
    subscription.billingContract || subscription.complimentaryAccessActive ||
    snapshot.organisationId !== subscription.organisationId || !id(snapshot.userId) ||
    !id(snapshot.organisationId) || snapshot.basePlanId !== subscription.planId || !id(snapshot.basePlanId) ||
    !validDate(subscription.currentPeriodEnd) || snapshot.expiresAt !== subscription.currentPeriodEnd.toISOString() ||
    Date.parse(snapshot.expiresAt) <= now.getTime() || !Number.isFinite(Date.parse(snapshot.issuedAt)) ||
    Date.parse(snapshot.issuedAt) > now.getTime() || Date.parse(snapshot.issuedAt) >= Date.parse(snapshot.expiresAt) ||
    !validPlan(snapshot.plan) || snapshot.plan.monthlyPriceCents !== 0 ||
    !Array.isArray(snapshot.pillars) || snapshot.pillars.length !== 1 || snapshot.pillars[0] !== snapshot.plan.productFamily ||
    !Object.entries(previewTesterOverrides(snapshot.pillars)).every(([key, enabled]) => subscription[key] === enabled) ||
    ["digitalSignageEnabled", "retailMediaEnabled", "schoolPublicPublishingEnabled"].some(key =>
      snapshot.plan[key] !== false || subscription[key] !== false)) return null;
  return Object.freeze({ ...snapshot.plan });
}

/** Bind only a currently authenticated, isolated Retail tester. The proof is
 * held outside the object so a JSON body, stored JSON or object spread cannot
 * masquerade as request authentication. Workers deliberately never bind this
 * overlay: tier exploration cannot alter the running encoder's permissions. */
export function bindSubscriberTestPlan(subscription, user, now = new Date()) {
  if (!subscription || typeof subscription !== "object") return subscription;
  bindings.delete(subscription);
  let state;
  try { state = assertPreviewTesterState(user, { now, requirePassword: false }); } catch { return subscription; }
  const snapshot = subscription.subscriberTestPlanSnapshot, grant = state.grant;
  if (grant.subscriberTestingEnabled !== true || user.email?.trim().toLowerCase() !== RETAIL_EMAIL ||
    grant.organisationId !== RETAIL_ORGANISATION || subscription.organisationId !== RETAIL_ORGANISATION ||
    state.pillars.length !== 1 || state.pillars[0] !== "RETAIL" || snapshot?.userId !== user.id ||
    state.subscription.planId !== subscription.planId || state.subscription.id !== subscription.id ||
    JSON.stringify(state.subscription.subscriberTestPlanSnapshot) !== JSON.stringify(snapshot) ||
    grant.expiresAt.toISOString() !== snapshot?.expiresAt || !readSubscriberTestPlan(subscription, now)) return subscription;
  bindings.set(subscription, { user, snapshot });
  return subscription;
}

export function resolveSubscriberTestPlan(subscription, now = new Date()) {
  if (!subscription || typeof subscription !== "object") return null;
  const binding = bindings.get(subscription);
  if (!binding || binding.snapshot !== subscription.subscriberTestPlanSnapshot) return null;
  // Recheck expiry and revocation in the request's authenticated grant.
  bindSubscriberTestPlan(subscription, binding.user, now);
  return bindings.has(subscription) ? readSubscriberTestPlan(subscription, now) : null;
}

/** Transactions must reload the grant before applying test limits. An ordinary
 * subscription has no snapshot and incurs no additional query. */
export async function loadSubscriberTestPlanBinding(db, subscription, now = new Date()) {
  const snapshot = subscription?.subscriberTestPlanSnapshot;
  if (!readSubscriberTestPlan(subscription, now) || !snapshot?.userId) return subscription;
  const user = await db.user.findUnique({ where: { id: snapshot.userId }, include: {
    privatePreviewAccess: true, memberships: { include: { organisation: { include: {
      enterpriseSecurityPolicy: true, subscription: { include: { plan: true, billingContract: true } }
    } } } }
  } });
  if (await db.organisationMember.count({ where: { organisationId: subscription.organisationId } }) !== 1) return subscription;
  return bindSubscriberTestPlan(subscription, user, now);
}
