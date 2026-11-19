import test from "node:test";
import assert from "node:assert/strict";
import { createRewardPilotAdminService } from "../lib/retail-rewards/pilot-admin-service.mjs";
import { requirePilotAdminAccess } from "../lib/retail-rewards/pilot-admin-access.mjs";
import { readPilotAdminPolicy, pilotAdminSchemas } from "../lib/retail-rewards/pilot-admin-contracts.mjs";
import { hashShopperInvitationToken } from "../lib/retail-rewards/shopper-auth-service.mjs";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";
import { pilotPreviewOwnerContext } from "./fixtures/rewards-pilot-preview-admin.mjs";

const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2026-11-30T12:00:00.000Z"), START = new Date("2026-11-01T00:00:00.000Z");
const copy = value => structuredClone(value);
const ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: '["org-one"]', SESSION_SECRET: "synthetic-local-only-pilot-session-secret" };
const LIMITS = { activeOffers: 3, locations: 2, staffSeats: 2, monthlyRedemptions: 100, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false };
const PREPARE = { organisationId: "org-one", expiresAt: END.toISOString(), tier: "REWARDS_STARTER", limits: LIMITS };
const SHOP = { organisationId: "org-one", locationId: "shop-one", publicSlug: "sample-shop", displayName: "Sample shop",
  description: "Public sample description", locality: "Valletta", countryCode: "MT", confirm: true };
const INVITE = { organisationId: "org-one", email: "pilot@example.test", displayName: "Synthetic shopper", expiresAt: END.toISOString(), confirm: true };
const PREPARED_INVITE = { organisationId: "org-one", shopperId: "prepared-shopper", email: "prepared@example.test", authVersion: 1,
  preparedAt: START.toISOString(), expiresAt: END.toISOString(), confirm: true };
const RENEWAL_REVIEW = { organisationId: "org-one", shopperId: "prepared-shopper" };
const RENEWAL_NOW = new Date(+NOW + 2 * 3600000);
const RENEWAL_END = new Date(+RENEWAL_NOW + 3600000).toISOString();
const RENEWAL_ID = "11111111-1111-4111-8111-111111111111";
const context = () => ({ user: { id: "super-admin", role: "SUPER_ADMIN", privatePreviewAccess: null },
  session: { id: "admin-session", userId: "super-admin", authMethod: "PASSWORD", expiresAt: END, revokedAt: null } });
function terms() { return { schemaVersion: 1, title: "10% sample coupon", description: "Sample", category: "FASHION", type: "PERCENT_OFF", percentBps: 1000,
  amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000, exclusions: "", legalTerms: "Local pilot only.",
  combinable: false, startsAt: START.toISOString(), endsAt: END.toISOString(), timezone: "Europe/Malta", locationIds: ["shop-one"],
  usage: "REUSABLE", totalLimit: 10, perShopperLimit: 2, perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED" }; }
function matches(row, where = {}) {
  return Object.entries(where).every(([key, wanted]) => {
    const actual = row?.[key];
    if (wanted instanceof Date) return actual instanceof Date && actual.getTime() === wanted.getTime();
    if (wanted && typeof wanted === "object") {
      if (Object.hasOwn(wanted, "equals")) return wanted.mode === "insensitive"
        ? typeof actual === "string" && actual.toLowerCase() === wanted.equals.toLowerCase() : actual === wanted.equals;
      if (Object.hasOwn(wanted, "in")) return wanted.in.includes(actual);
      if (Object.hasOwn(wanted, "not")) return actual !== wanted.not;
      if (Object.hasOwn(wanted, "gt")) return actual > wanted.gt;
      if (Object.hasOwn(wanted, "lte")) return actual <= wanted.lte;
      return matches(actual, wanted);
    }
    return actual === wanted;
  });
}
function project(row, select) {
  if (!row) return null; if (!select) return copy(row);
  return Object.fromEntries(Object.entries(select).map(([key, choice]) => {
    if (choice === true) return [key, copy(row[key])];
    const value = row[key];
    return [key, Array.isArray(value) ? value.filter(item => matches(item, choice.where)).slice(0, choice.take ?? value.length).map(item => project(item, choice.select)) : project(value, choice.select)];
  }));
}

// In-memory transaction adapter proves boundary decisions and atomic failure
// behavior; PostgreSQL migration/concurrency is checked separately.
function fixture({ prepared = true } = {}) {
  let source = {
    context: context(), user: [], rewardShopperSetup: [],
    organisation: [{ id: "org-one", name: "Test shop business", subscription: { id: "sub-one", organisationId: "org-one", status: "ACTIVE",
      plan: { active: true, code: "RETAIL_START", productFamily: "RETAIL", retailRadioEnabled: true } } }, { id: "other-org", name: "Foreign private business" }],
    location: [{ id: "shop-one", organisationId: "org-one", name: "Private shop name", status: "ACTIVE" }, { id: "shop-two", organisationId: "org-one", name: "Second shop", status: "ACTIVE" },
      { id: "foreign-shop", organisationId: "other-org", name: "Foreign", status: "ACTIVE" }],
    rewardProgram: prepared ? [{ id: "program-one", organisationId: "org-one", status: "ACTIVE", networkOptIn: true, timezone: "Europe/Malta", updatedAt: START }] : [],
    rewardEntitlementGrant: prepared ? [{ id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL",
      tier: "REWARDS_STARTER", status: "TRIAL", startsAt: START, expiresAt: END, revokedAt: null, limitsVersion: 1, updatedAt: START, ...LIMITS }] : [],
    rewardPublicShopProfile: [], rewardOffer: [], rewardOfferDiscovery: [], rewardShopper: [], rewardShopperCredential: [],
    rewardShopperMembership: [], rewardShopperInvitation: [], rewardPilotShopperEnrollment: [], rewardPilotAuditEvent: [],
    rewardShopperSession: [], rewardClaim: [], rewardRedemption: [], rewardStaffGrant: [], auditLog: []
  };
  const env = { ...ENV }, calls = []; let serial = 0, beforeTransaction, afterWrite, failAudit = false, current = NOW;
  function hydrated(model, row, data) {
    if (!row) return null;
    const r = copy(row);
    if (model === "rewardPublicShopProfile") r.location = data.location.find(l => l.id === r.locationId);
    if (model === "rewardOffer") r.discovery = data.rewardOfferDiscovery.find(d => d.offerId === r.id) || null;
    if (model === "rewardPilotShopperEnrollment") {
      const s = copy(data.rewardShopper.find(s => s.id === r.shopperId));
      if (s) { s.membership = data.rewardShopperMembership.find(m => m.shopperId === s.id); s.invitation = data.rewardShopperInvitation.find(i => i.shopperId === s.id); }
      r.shopper = s;
    }
    return r;
  }
  function client(data) {
    const result = { _data: data };
    for (const model of Object.keys(data).filter(k => k !== "context")) result[model] = {
      async findUnique(args) { calls.push({ model, method: "findUnique" }); return project(hydrated(model, data[model].find(r => matches(r, args.where)), data), args.select); },
      async findFirst(args) { calls.push({ model, method: "findFirst", args: copy(args) }); return project(hydrated(model, data[model].find(r => matches(r, args.where)), data), args.select); },
      async findMany(args = {}) { return data[model].map(row => hydrated(model, row, data)).filter(row => matches(row, args.where)).slice(0, args.take).map(row => project(row, args.select)); },
      async count(args) { return data[model].map(row => hydrated(model, row, data)).filter(row => matches(row, args.where)).length; },
      async create(args) {
        calls.push({ model, method: "create" });
        if (model === "rewardPilotAuditEvent" && failAudit) throw new Error("Synthetic audit failure");
        const row = { id: `${model}-${++serial}`, revokedAt: null, acceptedAt: null, createdAt: current,
          ...(["rewardProgram", "rewardEntitlementGrant", "rewardShopper", "rewardShopperMembership"].includes(model) ? { updatedAt: current } : {}), ...copy(args.data) };
        data[model].push(row); afterWrite?.(data, model); return project(hydrated(model, row, data), args.select);
      },
      async update(args) { calls.push({ model, method: "update" }); const row = data[model].find(r => matches(r, args.where));
        if (!row) throw new Error("Missing synthetic row"); Object.assign(row, copy(args.data));
        if (Object.hasOwn(row, "updatedAt")) row.updatedAt = current;
        afterWrite?.(data, model); return project(row, args.select); },
      async upsert(args) { const row = data[model].find(r => matches(r, args.where));
        if (row) return result[model].update({ where: args.where, data: args.update, select: args.select });
        return result[model].create({ data: args.create, select: args.select }); }
    };
    result.$queryRaw = async (parts, ...values) => {
      const sql = parts.join("?"); calls.push({ model: "lock", sql, values });
      if (sql.includes('FROM "User"')) return data.context.user.id === values[0] ? [{ id: values[0] }] : [];
      if (sql.includes('FROM "Session"')) return data.context.session.id === values[0] && data.context.session.userId === values[1] ? [{ id: values[0] }] : [];
      if (sql.includes('FROM "PrivatePreviewAccess"')) return data.context.user.privatePreviewAccess?.userId === values[0] ? [{ userId: values[0] }] : [];
      if (sql.includes('FROM "RewardShopperSetup"')) return data.rewardShopperSetup.filter(s => s.shopperId === values[0] && s.organisationId === values[1]).map(s => ({ shopperId: s.shopperId }));
      if (sql.includes('FROM "Subscription"')) { const sub = data.organisation.find(o => o.id === values[0])?.subscription; return sub ? [{ id: sub.id }] : []; }
      if (sql.includes('FROM "RewardProgram"')) return data.rewardProgram.filter(p => p.organisationId === values[0]).map(p => ({ id: p.id }));
      if (sql.includes('FROM "RewardEntitlementGrant"')) return data.rewardEntitlementGrant.filter(g => g.organisationId === values[0]).map(g => ({ id: g.id }));
      if (sql.includes('FROM "BillingContract"') || sql.includes('FROM "EnterpriseSecurityPolicy"')) return [];
      if (sql.includes('FROM "Location"') && sql.includes('jsonb_array_elements_text')) return data.location.filter(l => l.organisationId === values[0] && JSON.parse(values[1]).includes(l.id)).map(l => ({ id: l.id }));
      if (sql.includes('FROM "RewardPublicShopProfile"')) return data.rewardPublicShopProfile.filter(p => p.organisationId === values[0] && JSON.parse(values[1]).includes(p.locationId)).map(p => ({ locationId: p.locationId }));
      const map = { Organisation: "organisation", Location: "location", RewardOffer: "rewardOffer", RewardShopper: "rewardShopper",
        RewardShopperMembership: "rewardShopperMembership", RewardShopperInvitation: "rewardShopperInvitation" };
      const table = Object.keys(map).find(name => sql.includes(`FROM "${name}"`)), key = ["RewardShopperMembership", "RewardShopperInvitation"].includes(table) ? "shopperId" : "id";
      return data[map[table]].filter(row => row[key] === values[0] && (values[1] === undefined || row.organisationId === values[1]) && (!sql.includes("'ACTIVE'") || row.status === "ACTIVE")).map(row => ({ id: row.id }));
    };
    return result;
  }
  const db = new Proxy({}, { get(_target, key) { if (key === "$transaction") return async (operation, options) => {
    assert.equal(options.isolationLevel, "Serializable"); beforeTransaction?.(source);
    const working = copy(source); const result = await operation(client(working)); source = working; return result;
  }; return client(source)[key]; } });
  const service = createRewardPilotAdminService({ db, env, loadContext: async currentClient => copy(currentClient._data.context), clock: () => new Date(current) });
  return { service, env, calls, get data() { return source; }, set beforeTransaction(value) { beforeTransaction = value; },
    set afterWrite(value) { afterWrite = value; }, set failAudit(value) { failAudit = value; }, set now(value) { current = value; },
    addPreparedShopper() {
      env.RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED = "true"; env.RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED = "true";
      source.rewardShopper.push({ id: PREPARED_INVITE.shopperId, displayName: "Prepared synthetic shopper", status: "DISABLED", authVersion: 1, updatedAt: START });
      source.rewardShopperSetup.push({ shopperId: PREPARED_INVITE.shopperId, organisationId: "org-one", emailCanonical: PREPARED_INVITE.email,
        createdByUserId: "original-super-admin", createdAt: START });
      source.auditLog.push({ organisationId: "org-one", actorUserId: "original-super-admin", action: "DORMANT_SHOPPER_PREPARED",
        entityType: "RewardShopper", entityId: PREPARED_INVITE.shopperId, details: { shopperId: PREPARED_INVITE.shopperId, status: "DISABLED", accessGranted: false } });
    },
    addOffer() { const t = terms(); source.rewardOffer.push({ id: "offer-one", organisationId: "org-one", programId: "program-one", state: "PUBLISHED", publishedRevision: 1,
      publishedStartsAt: START, publishedEndsAt: END, publishedSnapshot: { organisationId: "org-one", offerId: "offer-one", revision: 1, terms: t },
      locations: [{ organisationId: "org-one", offerId: "offer-one", locationId: "shop-one", scope: "PUBLISHED" }] }); }
  };
}

test("pilot policy requires explicit default-off gate and exact bounded unique organisation allowlist", () => {
  assert.equal(readPilotAdminPolicy().enabled, false);
  assert.equal(readPilotAdminPolicy(ENV).enabled, true);
  for (const patch of [{ RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "TRUE" },
    ...[undefined, "[]", "null", "{}", '["org-one","org-one"]', '["../org-one"]', JSON.stringify(Array.from({ length: 11 }, (_, i) => `org-${i}`))].map(value => ({ RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: value }))]) {
    assert.equal(readPilotAdminPolicy({ ...ENV, ...patch }).enabled, false);
  }
});

test("pilot contracts reject implicit confirmation, unknown fields, malformed dates and unsafe public identifiers", () => {
  assert.equal(pilotAdminSchemas.prepare.safeParse(PREPARE).success, true);
  assert.equal(pilotAdminSchemas.publishShop.safeParse(SHOP).success, true);
  for (const bad of [{ ...SHOP, confirm: false }, { ...SHOP, confirm: undefined }, { ...SHOP, publicSlug: "../secret" }, { ...SHOP, admin: true }, { ...SHOP, displayName: "Bad\u0000text" }]) assert.equal(pilotAdminSchemas.publishShop.safeParse(bad).success, false);
  assert.equal(pilotAdminSchemas.prepare.safeParse({ ...PREPARE, expiresAt: "tomorrow" }).success, false);
  assert.equal(pilotAdminSchemas.prepare.safeParse({ ...PREPARE, limits: { ...LIMITS, locations: "10" } }).success, false);
});

test("only fresh normal Super Admin sessions authorize explicit pilot organisations", async () => {
  const allowed = await requirePilotAdminAccess({ env: ENV, clock: () => NOW, organisationId: "org-one", loadContext: async () => context() }); assert.equal(allowed.ok, true);
  for (const mutate of [c => c.user.role = "SUPPORT", c => c.user.role = "OWNER", c => c.user.privatePreviewAccess = { userId: c.user.id },
    c => c.session.authMethod = "PREVIEW_LOGIN_CODE", c => c.session.revokedAt = NOW, c => c.session.expiresAt = NOW, c => c.session.userId = "other-user"]) {
    const c = context(); mutate(c); assert.equal((await requirePilotAdminAccess({ env: ENV, clock: () => NOW, organisationId: "org-one", loadContext: async () => c })).ok, false);
  }
  assert.equal((await requirePilotAdminAccess({ env: ENV, clock: () => NOW, organisationId: "other-org", loadContext: async () => context() })).code, "FORBIDDEN");
});

test("disabled gate avoids all context and database activity", async () => {
  const f = fixture(); f.env.RUVANAS_RETAIL_REWARDS_ENABLED = "false";
  assert.equal((await f.service.invite(INVITE)).code, "FEATURE_DISABLED"); assert.equal(f.calls.length, 0);
});

test("configured preview owner can prepare only an allowlisted pilot with existing grant locked", async () => {
  const f = fixture({ prepared: false }); Object.assign(f.env, pilotPreviewEnvironment());
  f.data.context = pilotPreviewOwnerContext(NOW);
  assert.equal((await f.service.prepare({ ...PREPARE, organisationId: "other-org" })).code, "FORBIDDEN");
  assert.equal((await f.service.prepare(PREPARE)).ok, true);
  assert.equal(f.data.rewardProgram.length, 1);
  assert.equal(f.data.rewardPilotAuditEvent[0].actorUserId, "preview-owner");
  const locks = f.calls.filter(c => c.model === "lock");
  const grant = locks.findIndex(c => c.sql.includes('FROM "PrivatePreviewAccess"'));
  assert.ok(grant >= 0);
  assert.match(locks[grant].sql, /FOR SHARE/);
  assert.deepEqual(locks[grant].values, ["preview-owner"]);
  assert.ok(locks.findIndex(c => c.sql.includes('FROM "User"')) < grant);
});

test("preview grant revocation, mode change or bridge withdrawal after write rolls the pilot mutation back", async () => {
  for (const mutate of [d => d.context.user.privatePreviewAccess.enabled = false,
    d => d.context.user.privatePreviewAccess.passwordEnabled = false,
    d => { d.context.session.authMethod = "PASSWORD"; d.context.user.privatePreviewAccess = null; },
    (_d, f) => f.env.RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED = "false"]) {
    const f = fixture({ prepared: false }); Object.assign(f.env, pilotPreviewEnvironment());
    f.data.context = pilotPreviewOwnerContext(NOW);
    f.afterWrite = (data, model) => { if (model === "rewardProgram") mutate(data, f); };
    assert.equal((await f.service.prepare(PREPARE)).ok, false, String(mutate));
    assert.equal(f.data.rewardProgram.length, 0); assert.equal(f.data.rewardEntitlementGrant.length, 0);
    assert.equal(f.data.rewardPilotAuditEvent.length, 0);
  }
});

test("organisation selector and overview never return non-allowlisted organisations or private shopper credentials", async () => {
  const f = fixture(); const list = await f.service.organisations({}); assert.deepEqual(list.organisations, [{ id: "org-one", name: "Test shop business" }]);
  assert.equal((await f.service.overview({ organisationId: "other-org" })).code, "FORBIDDEN");
  const issued = await f.service.invite(INVITE); assert.equal(issued.ok, true);
  const overview = await f.service.overview({ organisationId: "org-one" }); assert.equal(overview.ok, true);
  assert.equal(overview.shoppers.length, 1); assert.equal(overview.shoppers[0].invitationStatus, "PENDING");
  const text = JSON.stringify(overview); for (const secret of [issued.invitationToken, INVITE.email, "tokenHash", "passwordHash", "Foreign private business"]) assert.equal(text.includes(secret), false);
});

test("create-only pilot preparation keeps subscription and plan unchanged and records explicit limits", async () => {
  const f = fixture({ prepared: false }), before = copy(f.data.organisation);
  assert.equal((await f.service.prepare(PREPARE)).ok, true);
  assert.deepEqual(f.data.organisation, before); assert.equal(f.data.rewardProgram[0].networkOptIn, true);
  assert.deepEqual(Object.fromEntries(Object.keys(LIMITS).map(k => [k, f.data.rewardEntitlementGrant[0][k]])), LIMITS);
  assert.equal(f.data.rewardPilotAuditEvent[0].action, "PROGRAM_PREPARED");
  assert.equal((await f.service.prepare(PREPARE)).code, "CONFLICT"); assert.equal(f.data.rewardProgram.length, 1);
});

test("preparation rejects expired or overlong grants and non-Retail subscriptions", async () => {
  for (const expiresAt of [NOW.toISOString(), new Date(NOW.getTime() + 31 * 86400000).toISOString()]) {
    const f = fixture({ prepared: false }); assert.equal((await f.service.prepare({ ...PREPARE, expiresAt })).code, "INVALID_REQUEST"); assert.equal(f.data.rewardProgram.length, 0);
  }
  const f = fixture({ prepared: false }); f.data.organisation[0].subscription.plan.retailRadioEnabled = false;
  assert.equal((await f.service.prepare(PREPARE)).code, "NOT_ENTITLED"); assert.equal(f.data.rewardProgram.length, 0);
});

test("role and session authority are checked again inside transaction before writes", async () => {
  for (const change of [s => s.context.user.role = "OWNER", s => s.context.session.revokedAt = NOW, s => s.context.session.id = "replacement-session"]) {
    const f = fixture(); f.beforeTransaction = change; assert.equal((await f.service.publishShop(SHOP)).ok, false); assert.equal(f.data.rewardPublicShopProfile.length, 0);
  }
});

test("late authority change or failed audit rolls back the entire pilot mutation", async () => {
  const f = fixture(); f.afterWrite = (data, model) => { if (model === "rewardPublicShopProfile") data.context.user.role = "SUPPORT"; };
  assert.equal((await f.service.publishShop(SHOP)).code, "FORBIDDEN"); assert.equal(f.data.rewardPublicShopProfile.length, 0); assert.equal(f.data.rewardPilotAuditEvent.length, 0);
  const g = fixture({ prepared: false }); g.failAudit = true;
  assert.equal((await g.service.prepare(PREPARE)).code, "UNAVAILABLE"); assert.equal(g.data.rewardProgram.length, 0); assert.equal(g.data.rewardEntitlementGrant.length, 0);
});

test("shop publication requires same-tenant active location, explicit public text, and remaining location allowance", async () => {
  const f = fixture(); assert.equal((await f.service.publishShop({ ...SHOP, locationId: "foreign-shop" })).code, "LOCATION_UNAVAILABLE");
  f.data.rewardEntitlementGrant[0].locations = 1;
  assert.equal((await f.service.publishShop(SHOP)).ok, true);
  assert.equal(f.data.rewardPublicShopProfile[0].displayName, SHOP.displayName); assert.notEqual(f.data.rewardPublicShopProfile[0].displayName, f.data.location[0].name);
  assert.equal((await f.service.publishShop({ ...SHOP, locationId: "shop-two", publicSlug: "second-shop" })).code, "LIMIT_REACHED");
  assert.equal((await f.service.publishShop({ ...SHOP, description: "Reviewed again" })).ok, true);
});

test("coupon discovery approves only the exact published revision and public active shops", async () => {
  const f = fixture(); f.addOffer(); const request = { organisationId: "org-one", offerId: "offer-one", revision: 1, publicSlug: "sample-coupon", confirm: true };
  assert.equal((await f.service.approveOffer(request)).code, "LOCATION_UNAVAILABLE");
  assert.equal((await f.service.publishShop(SHOP)).ok, true);
  assert.equal((await f.service.approveOffer({ ...request, revision: 2 })).code, "CONFLICT");
  assert.equal((await f.service.approveOffer(request)).ok, true); assert.equal(f.data.rewardOfferDiscovery[0].revision, 1);
  f.data.rewardOffer[0].publishedRevision = 2; f.data.rewardOffer[0].publishedSnapshot.revision = 2;
  assert.equal(f.data.rewardOfferDiscovery[0].revision, 1); assert.equal((await f.service.approveOffer(request)).code, "CONFLICT");
});

test("malformed or foreign published location snapshots never gain discovery consent", async () => {
  const f = fixture(); f.addOffer(); await f.service.publishShop(SHOP); f.data.rewardOffer[0].locations[0].organisationId = "other-org";
  assert.equal((await f.service.approveOffer({ organisationId: "org-one", offerId: "offer-one", revision: 1, publicSlug: "sample-coupon", confirm: true })).code, "OFFER_UNAVAILABLE");
  assert.equal(f.data.rewardOfferDiscovery.length, 0);
});

test("invitations create separate disabled global shoppers with one-use hashed tokens and safe audit", async () => {
  const f = fixture(); const result = await f.service.invite(INVITE); assert.equal(result.ok, true); assert.match(result.invitationToken, /^[a-f0-9]{64}$/);
  assert.equal(f.data.rewardShopper[0].status, "DISABLED"); assert.equal(f.data.rewardShopperCredential.length, 0);
  assert.equal(f.data.rewardShopperMembership[0].expiresAt.toISOString(), INVITE.expiresAt);
  assert.equal(f.data.rewardShopperInvitation[0].tokenHash, hashShopperInvitationToken(result.invitationToken, ENV.SESSION_SECRET));
  assert.equal(f.data.rewardShopperInvitation[0].expiresAt - f.data.rewardShopperInvitation[0].createdAt, 86400000);
  assert.equal(f.data.rewardPilotShopperEnrollment[0].organisationId, "org-one");
  for (const secret of [result.invitationToken, INVITE.email, INVITE.displayName, "tokenHash"]) assert.equal(JSON.stringify(f.data.rewardPilotAuditEvent).includes(secret), false);
});

test("business account, invitation, credential and dormant setup emails are never adopted or rebound", async () => {
  for (const table of ["user", "rewardShopperCredential", "rewardShopperInvitation", "rewardShopperSetup"]) {
    const f = fixture(); f.data[table].push(table === "user"
      ? { id: "existing-business-user", email: INVITE.email.toUpperCase() }
      : { shopperId: "existing-other-shopper", emailCanonical: INVITE.email.toUpperCase(), organisationId: "other-org" });
    const before = copy(f.data);
    assert.equal((await f.service.invite(INVITE)).code, "CONFLICT"); assert.deepEqual(f.data, before);
    for (const identity of ["user", "rewardShopperCredential", "rewardShopperInvitation", "rewardShopperSetup"]) {
      const lookup = f.calls.find(call => call.model === identity && call.method === "findFirst");
      assert.deepEqual(lookup?.args.where, { [identity === "user" ? "email" : "emailCanonical"]: { equals: INVITE.email, mode: "insensitive" } });
    }
  }
});

test("an email reserved before the invite transaction is rechecked without issuing any access", async () => {
  const f = fixture();
  f.beforeTransaction = data => { data.rewardShopperSetup.push({ shopperId: "prepared-shopper", emailCanonical: INVITE.email, organisationId: "org-one" }); };
  assert.equal((await f.service.invite(INVITE)).code, "CONFLICT");
  for (const model of ["rewardShopper", "rewardShopperMembership", "rewardShopperInvitation", "rewardShopperCredential", "rewardPilotShopperEnrollment", "rewardPilotAuditEvent"]) {
    assert.equal(f.data[model].length, 0);
  }
});

test("shopper membership cannot outlive the pilot and failed invitation audit leaves no shopper", async () => {
  const f = fixture(); assert.equal((await f.service.invite({ ...INVITE, expiresAt: new Date(END.getTime() + 1).toISOString() })).code, "INVALID_REQUEST");
  f.failAudit = true; assert.equal((await f.service.invite(INVITE)).code, "UNAVAILABLE");
  for (const table of ["rewardShopper", "rewardShopperMembership", "rewardShopperInvitation", "rewardPilotShopperEnrollment"]) assert.equal(f.data[table].length, 0);
});

test("reissue rotates only origin-bound pending invites and uses shopper-membership-invitation lock order", async () => {
  const f = fixture(); const first = await f.service.invite(INVITE); const oldHash = f.data.rewardShopperInvitation[0].tokenHash;
  const result = await f.service.reissue({ organisationId: "org-one", shopperId: first.shopperId, confirm: true }); assert.equal(result.ok, true);
  assert.notEqual(result.invitationToken, first.invitationToken); assert.notEqual(f.data.rewardShopperInvitation[0].tokenHash, oldHash);
  const locks = f.calls.filter(call => call.model === "lock").map(call => call.sql);
  const shopper = locks.findIndex(sql => sql.includes('FROM "RewardShopper"'));
  assert.match(locks[shopper + 1], /FROM "RewardShopperMembership"/); assert.match(locks[shopper + 2], /FROM "RewardShopperInvitation"/);
  f.data.rewardPilotShopperEnrollment[0].organisationId = "other-org";
  assert.equal((await f.service.reissue({ organisationId: "org-one", shopperId: first.shopperId, confirm: true })).code, "INVITATION_UNAVAILABLE");
});

test("accepted or credentialed shoppers cannot be reissued or revoked by pilot invitation controls", async () => {
  for (const change of [f => f.data.rewardShopper[0].status = "ACTIVE", f => f.data.rewardShopperInvitation[0].acceptedAt = NOW,
    f => f.data.rewardShopperCredential.push({ shopperId: f.data.rewardShopper[0].id, emailCanonical: INVITE.email })]) {
    const f = fixture(), first = await f.service.invite(INVITE); change(f); const request = { organisationId: "org-one", shopperId: first.shopperId, confirm: true };
    assert.equal((await f.service.reissue(request)).code, "INVITATION_UNAVAILABLE"); assert.equal((await f.service.revoke(request)).code, "INVITATION_UNAVAILABLE");
  }
});

test("another allowlisted pilot cannot claim invitation ownership", async () => {
  const f = fixture(), issued = await f.service.invite(INVITE);
  f.env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["org-one","other-org"]';
  const secondOrg = copy(f.data.organisation[0]); secondOrg.id = "other-org"; secondOrg.subscription.id = "sub-other"; secondOrg.subscription.organisationId = "other-org";
  f.data.organisation[1] = secondOrg;
  f.data.rewardProgram.push({ ...copy(f.data.rewardProgram[0]), id: "program-other", organisationId: "other-org" });
  f.data.rewardEntitlementGrant.push({ ...copy(f.data.rewardEntitlementGrant[0]), id: "grant-other", organisationId: "other-org", subscriptionId: "sub-other" });
  const request = { organisationId: "other-org", shopperId: issued.shopperId, confirm: true };
  assert.equal((await f.service.reissue(request)).code, "INVITATION_UNAVAILABLE");
  assert.equal((await f.service.revoke(request)).code, "INVITATION_UNAVAILABLE");
  assert.equal(f.data.rewardPilotShopperEnrollment[0].organisationId, "org-one");
  assert.equal(f.data.rewardShopperInvitation[0].revokedAt, null);
});

test("revoking a pending invite works after pilot expiry and changes no membership or session", async () => {
  const f = fixture(), first = await f.service.invite(INVITE), membership = copy(f.data.rewardShopperMembership);
  f.data.rewardEntitlementGrant[0].expiresAt = NOW; const request = { organisationId: "org-one", shopperId: first.shopperId, confirm: true };
  assert.equal((await f.service.revoke(request)).ok, true); assert.equal(f.data.rewardShopperInvitation[0].revokedAt.toISOString(), NOW.toISOString());
  assert.deepEqual(f.data.rewardShopperMembership, membership); assert.equal((await f.service.revoke(request)).code, "CONFLICT");
});

test("expired membership cannot be reissued and clock expiry during invite rolls back", async () => {
  const f = fixture(), first = await f.service.invite(INVITE); f.data.rewardShopperMembership[0].expiresAt = NOW;
  assert.equal((await f.service.reissue({ organisationId: "org-one", shopperId: first.shopperId, confirm: true })).code, "INVITATION_UNAVAILABLE");
  const g = fixture(); g.afterWrite = (_data, model) => { if (model === "rewardPilotAuditEvent") g.now = new Date(NOW.getTime() + 2000); };
  assert.equal((await g.service.invite({ ...INVITE, expiresAt: new Date(NOW.getTime() + 1000).toISOString() })).code, "INVITATION_UNAVAILABLE"); assert.equal(g.data.rewardShopper.length, 0);
});

test("overview fails rather than silently truncating oversized location candidates", async () => {
  const f = fixture(); for (let i = 0; i < 100; i++) f.data.location.push({ id: `extra-${i}`, organisationId: "org-one", name: "Sample", status: "ACTIVE" });
  assert.equal((await f.service.overview({ organisationId: "org-one" })).code, "REVIEW_TOO_LARGE");
});

test("prepared invitation contract pins the exact identity, version and preparation and accepts no privilege fields", () => {
  assert.equal(pilotAdminSchemas.invitePrepared.safeParse(PREPARED_INVITE).success, true);
  for (const patch of [{ shopperId: undefined }, { email: undefined }, { authVersion: 2 }, { authVersion: "1" },
    { preparedAt: "yesterday" }, { expiresAt: "2026-11-30" }, { confirm: false }, { displayName: "Replace name" }, { status: "ACTIVE" }]) {
    assert.equal(pilotAdminSchemas.invitePrepared.safeParse({ ...PREPARED_INVITE, ...patch }).success, false);
  }
});

test("exact prepared shopper receives one origin-bound invitation without changing disabled identity or provenance", async () => {
  const f = fixture(); f.addPreparedShopper();
  const before = copy({ shopper: f.data.rewardShopper, setup: f.data.rewardShopperSetup, audit: f.data.auditLog, organisations: f.data.organisation });
  const result = await f.service.invitePrepared(PREPARED_INVITE);
  assert.equal(result.ok, true); assert.equal(result.shopperId, PREPARED_INVITE.shopperId);
  assert.match(result.invitationToken, /^[a-f0-9]{64}$/);
  assert.deepEqual({ shopper: f.data.rewardShopper, setup: f.data.rewardShopperSetup, audit: f.data.auditLog, organisations: f.data.organisation }, before);
  assert.equal(f.data.rewardShopperInvitation[0].tokenHash, hashShopperInvitationToken(result.invitationToken, ENV.SESSION_SECRET));
  assert.equal(f.data.rewardShopperInvitation[0].emailCanonical, PREPARED_INVITE.email);
  assert.equal(f.data.rewardShopperInvitation[0].authVersion, 1);
  assert.equal(f.data.rewardShopperInvitation[0].expiresAt - NOW, 86400000);
  assert.equal(f.data.rewardShopperMembership[0].expiresAt.toISOString(), PREPARED_INVITE.expiresAt);
  assert.deepEqual(f.data.rewardPilotShopperEnrollment.map(r => [r.shopperId, r.organisationId, r.createdByUserId]), [[PREPARED_INVITE.shopperId, "org-one", "super-admin"]]);
  for (const table of ["user", "rewardShopperCredential", "rewardShopperSession", "rewardClaim", "rewardRedemption"]) assert.equal(f.data[table].length, 0);
  for (const privateText of [result.invitationToken, PREPARED_INVITE.email, "tokenHash", "Prepared synthetic shopper"]) assert.equal(JSON.stringify(f.data.rewardPilotAuditEvent).includes(privateText), false);
  assert.deepEqual(Object.keys(f.data.rewardPilotAuditEvent[0].metadataJson).sort(), ["expiresAt", "status"]);
  const locks = f.calls.filter(c => c.model === "lock");
  const index = locks.findIndex(c => c.sql.includes('FROM "RewardShopper"'));
  assert.match(locks[index].sql, /FOR UPDATE/); assert.match(locks[index + 1].sql, /FROM "RewardShopperSetup".*FOR SHARE/);
  const saved = copy(f.data); assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "INVITATION_UNAVAILABLE"); assert.deepEqual(f.data, saved);
});

test("prepared shopper overview is read-only, tenant scoped and removes already-invited or changed preparations", async () => {
  const f = fixture(); f.addPreparedShopper(); const before = copy(f.data);
  f.data.rewardShopperSetup.push({ shopperId: "foreign-prepared", organisationId: "other-org", emailCanonical: "foreign@example.test" });
  const result = await f.service.overview({ organisationId: "org-one" });
  assert.deepEqual(result.preparedShoppers, [{ shopperId: PREPARED_INVITE.shopperId, email: PREPARED_INVITE.email,
    displayName: "Prepared synthetic shopper", authVersion: 1, preparedAt: START.toISOString() }]);
  assert.equal(JSON.stringify(result).includes("foreign@example.test"), false);
  assert.equal(f.calls.some(c => ["create", "update"].includes(c.method)), false);
  assert.deepEqual(f.data.rewardShopper, before.rewardShopper);
  assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).ok, true);
  assert.deepEqual((await f.service.overview({ organisationId: "org-one" })).preparedShoppers, []);
  const g = fixture(); g.addPreparedShopper(); g.data.auditLog[0].details.accessGranted = true;
  assert.deepEqual((await g.service.overview({ organisationId: "org-one" })).preparedShoppers, []);
});

test("prepared invitation requires shopper authentication gates and a usable private-preview bridge", async () => {
  for (const patch of [{ RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "false" },
    { RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "false" }, { RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "TRUE" }]) {
    const f = fixture(); f.addPreparedShopper(); Object.assign(f.env, patch);
    assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "FEATURE_DISABLED"); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.addPreparedShopper(); Object.assign(f.env, pilotPreviewEnvironment(), { RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "false" });
  assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "FORBIDDEN"); assert.equal(f.calls.length, 0);
  const g = fixture(); g.addPreparedShopper(); Object.assign(g.env, pilotPreviewEnvironment()); g.data.context = pilotPreviewOwnerContext(NOW);
  assert.equal((await g.service.invitePrepared(PREPARED_INVITE)).ok, true);
});

test("wrong shopper pins, tenant, disabled state or immutable provenance never invite a prepared identity", async () => {
  for (const patch of [{ shopperId: "absent" }, { email: "different@example.test" }, { preparedAt: NOW.toISOString() }]) {
    const f = fixture(); f.addPreparedShopper(); const before = copy(f.data);
    assert.equal((await f.service.invitePrepared({ ...PREPARED_INVITE, ...patch })).code, "INVITATION_UNAVAILABLE"); assert.deepEqual(f.data, before);
  }
  for (const mutate of [d => d.rewardShopper[0].status = "ACTIVE", d => d.rewardShopper[0].status = "SUSPENDED", d => d.rewardShopper[0].authVersion = 2,
    d => d.rewardShopperSetup[0].organisationId = "other-org", d => d.rewardShopperSetup[0].emailCanonical = PREPARED_INVITE.email.toUpperCase(),
    d => d.rewardShopperSetup[0].createdByUserId = "different-admin", d => d.rewardShopperSetup[0].createdAt = new Date(+NOW + 1),
    d => d.auditLog.splice(0), d => d.auditLog.push(copy(d.auditLog[0])), d => d.auditLog[0].details.accessGranted = true,
    d => d.auditLog[0].details.status = "ACTIVE", d => d.auditLog[0].details.shopperId = "another-shopper"]) {
    const f = fixture(); f.addPreparedShopper(); mutate(f.data); const before = copy(f.data);
    assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "INVITATION_UNAVAILABLE", String(mutate)); assert.deepEqual(f.data, before);
  }
});

test("prepared invitation refuses every preexisting access row, including expired or revoked history", async () => {
  for (const table of ["rewardShopperCredential", "rewardShopperInvitation", "rewardShopperMembership", "rewardShopperSession",
    "rewardPilotShopperEnrollment", "rewardClaim", "rewardRedemption"]) {
    const f = fixture(); f.addPreparedShopper();
    f.data[table].push({ id: "existing-record", shopperId: PREPARED_INVITE.shopperId, organisationId: "other-org", expiresAt: START, revokedAt: START });
    const before = copy(f.data); assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "INVITATION_UNAVAILABLE", table); assert.deepEqual(f.data, before);
  }
});

test("prepared canonical email cannot collide with business, credential, invitation or another preparation", async () => {
  for (const table of ["user", "rewardShopperCredential", "rewardShopperInvitation", "rewardShopperSetup"]) {
    const f = fixture(); f.addPreparedShopper(); f.data[table].push(table === "user" ? { id: "business-user", email: PREPARED_INVITE.email.toUpperCase() }
      : { shopperId: "other-shopper", organisationId: "other-org", emailCanonical: PREPARED_INVITE.email.toUpperCase() });
    const before = copy(f.data); assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "INVITATION_UNAVAILABLE"); assert.deepEqual(f.data, before);
  }
  const f = fixture(); f.addPreparedShopper(); f.beforeTransaction = d => d.rewardShopperSession.push({ shopperId: PREPARED_INVITE.shopperId, id: "new-session" });
  assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "INVITATION_UNAVAILABLE"); assert.equal(f.data.rewardShopperInvitation.length, 0);
});

test("prepared invitation bounds expiries and enrollment capacity and requires current entitlement", async () => {
  for (const expiresAt of [NOW.toISOString(), new Date(+END + 1).toISOString(), new Date(+NOW + 31 * 86400000).toISOString()]) {
    const f = fixture(); f.addPreparedShopper(); assert.equal((await f.service.invitePrepared({ ...PREPARED_INVITE, expiresAt })).code, "INVALID_REQUEST");
    assert.equal(f.data.rewardShopperMembership.length, 0);
  }
  const f = fixture(); f.addPreparedShopper();
  const result = await f.service.invitePrepared({ ...PREPARED_INVITE, expiresAt: new Date(+NOW + 3600000).toISOString() });
  assert.equal(result.invitationExpiresAt, result.membershipExpiresAt);
  const g = fixture(); g.addPreparedShopper(); g.data.rewardPilotShopperEnrollment.push(...Array.from({ length: 100 }, (_, i) => ({ organisationId: "org-one", shopperId: `shopper-${i}` })));
  assert.equal((await g.service.invitePrepared(PREPARED_INVITE)).code, "LIMIT_REACHED");
  for (const mutate of [d => d.rewardProgram[0].status = "DISABLED", d => d.rewardEntitlementGrant[0].expiresAt = NOW,
    d => d.organisation[0].subscription.plan.retailRadioEnabled = false]) {
    const h = fixture(); h.addPreparedShopper(); mutate(h.data); assert.equal((await h.service.invitePrepared(PREPARED_INVITE)).code, "NOT_ENTITLED");
  }
});

test("prepared invitation rolls back on stale authority, withdrawn policies, entitlement changes, audit failure and clock expiry", async () => {
  for (const change of [d => d.context.user.role = "OWNER", d => d.context.session.revokedAt = NOW]) {
    const f = fixture(); f.addPreparedShopper(); f.beforeTransaction = change;
    assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).ok, false); assert.equal(f.data.rewardShopperMembership.length, 0);
  }
  for (const change of [d => d.context.user.role = "OWNER", d => d.context.session.revokedAt = NOW,
    d => d.rewardEntitlementGrant[0].revokedAt = NOW, (_d, f) => f.env.RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED = "false",
    (_d, f) => f.env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["other-org"]', (_d, f) => f.now = END]) {
    const f = fixture(); f.addPreparedShopper(); const before = copy(f.data);
    f.afterWrite = (d, model) => { if (model === "rewardPilotAuditEvent") change(d, f); };
    assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).ok, false); assert.deepEqual(f.data, before);
  }
  const f = fixture(); f.addPreparedShopper(); f.failAudit = true; const before = copy(f.data);
  assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "UNAVAILABLE"); assert.deepEqual(f.data, before);
});

test("prepared invitation retains existing pending reissue and revoke workflow while ordinary invite still refuses setup email", async () => {
  const f = fixture(); f.addPreparedShopper();
  assert.equal((await f.service.invite({ ...INVITE, email: PREPARED_INVITE.email })).code, "CONFLICT");
  const issued = await f.service.invitePrepared(PREPARED_INVITE); assert.equal(issued.ok, true);
  const request = { organisationId: "org-one", shopperId: PREPARED_INVITE.shopperId, confirm: true };
  const rotated = await f.service.reissue(request); assert.equal(rotated.ok, true); assert.notEqual(rotated.invitationToken, issued.invitationToken);
  assert.equal((await f.service.revoke(request)).ok, true);
  assert.equal(f.data.rewardShopper[0].status, "DISABLED"); assert.equal(f.data.rewardShopperCredential.length, 0);
  assert.equal((await f.service.invitePrepared(PREPARED_INVITE)).code, "INVITATION_UNAVAILABLE");
});

async function expiredRenewalFixture() {
  const f = fixture(); f.addPreparedShopper(); Object.assign(f.env, pilotPreviewEnvironment());
  const expiry = new Date(+NOW + 3600000);
  f.data.rewardEntitlementGrant[0].expiresAt = expiry;
  const issued = await f.service.invitePrepared({ ...PREPARED_INVITE, expiresAt: expiry.toISOString() });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  assert.equal((await f.service.revoke({ ...RENEWAL_REVIEW, confirm: true })).ok, true);
  f.now = RENEWAL_NOW;
  return f;
}
async function renewalInput(f) {
  const review = await f.service.renewalReview(RENEWAL_REVIEW);
  assert.equal(review.ok, true, JSON.stringify(review));
  return { ...RENEWAL_REVIEW, expectedState: review.expectedState, expiresAt: RENEWAL_END, requestId: RENEWAL_ID, confirm: true };
}

test("expired renewal review is read only, typed, private and pins current state", async () => {
  const f = await expiredRenewalFixture(), before = copy(f.data), writeCount = f.calls.filter(c => ["create", "update"].includes(c.method)).length;
  const review = await f.service.renewalReview(RENEWAL_REVIEW);
  assert.equal(review.ok, true, JSON.stringify(review)); assert.match(review.expectedState, /^[a-f0-9]{64}$/);
  assert.deepEqual(review.grant.limits, LIMITS); assert.equal(review.email, PREPARED_INVITE.email);
  assert.equal(review.invitation.status, "REVOKED"); assert.equal(review.checkedAt, RENEWAL_NOW.toISOString());
  assert.deepEqual(f.data, before); assert.equal(f.calls.filter(c => ["create", "update"].includes(c.method)).length, writeCount);
  const json = JSON.stringify(review);
  for (const privateField of ["tokenHash", "passwordHash", "SESSION_SECRET", before.rewardShopperInvitation[0].tokenHash]) assert.equal(json.includes(privateField), false);
});

test("renewal extends same two records once, preserves history, identity, limits and closed invitation", async () => {
  const f = await expiredRenewalFixture(), input = await renewalInput(f), before = copy(f.data);
  const result = await f.service.renew(input); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.grantId, before.rewardEntitlementGrant[0].id); assert.equal(result.membershipId, before.rewardShopperMembership[0].id);
  assert.equal(result.membershipVersion, before.rewardShopperMembership[0].version + 1); assert.equal(result.expiresAt, RENEWAL_END);
  for (const model of Object.keys(before).filter(k => !["rewardEntitlementGrant", "rewardShopperMembership", "rewardPilotAuditEvent"].includes(k))) assert.deepEqual(f.data[model], before[model], model);
  for (const model of ["rewardEntitlementGrant", "rewardShopperMembership"]) {
    assert.equal(f.data[model].length, before[model].length);
    for (const key of Object.keys(before[model][0]).filter(k => !["expiresAt", "version", "updatedAt"].includes(k))) assert.deepEqual(f.data[model][0][key], before[model][0][key], `${model}.${key}`);
  }
  const event = f.data.rewardPilotAuditEvent.at(-1); assert.equal(event.action, "PILOT_ACCESS_RENEWED"); assert.equal(event.targetType, "PROGRAM");
  assert.equal(event.requestId, input.requestId); assert.equal(event.metadataJson.status, "RENEWED");
  assert.equal(event.metadataJson.previousGrantExpiry, before.rewardEntitlementGrant[0].expiresAt.toISOString());
  assert.equal(event.metadataJson.previousMembershipExpiry, before.rewardShopperMembership[0].expiresAt.toISOString());
  assert.equal(JSON.stringify(event).includes(before.rewardShopperInvitation[0].tokenHash), false);
  const after = copy(f.data); assert.deepEqual(await f.service.renew(input), result); assert.deepEqual(f.data, after);
});

test("renewal retries reject altered requests, actor/state drift and reissued invitations", async () => {
  for (const mutate of [input => ({ ...input, expectedState: "b".repeat(64) }), input => ({ ...input, expiresAt: new Date(Date.parse(input.expiresAt) + 1000).toISOString() }),
    input => ({ ...input, requestId: "22222222-2222-4222-8222-222222222222" })]) {
    const f = await expiredRenewalFixture(), input = await renewalInput(f); assert.equal((await f.service.renew(input)).ok, true);
    const before = copy(f.data); assert.equal((await f.service.renew(mutate(input))).ok, false); assert.deepEqual(f.data, before);
  }
  const f = await expiredRenewalFixture(), input = await renewalInput(f); assert.equal((await f.service.renew(input)).ok, true);
  assert.equal((await f.service.reissue({ ...RENEWAL_REVIEW, confirm: true })).ok, true);
  const before = copy(f.data); assert.equal((await f.service.renew(input)).ok, false); assert.deepEqual(f.data, before);
});

test("renewal bounds and strict request reject zero, past, thirty-day, unknown fields and implicit confirmation", async () => {
  const f = await expiredRenewalFixture(), input = await renewalInput(f);
  for (const bad of [{ ...input, confirm: false }, { ...input, confirm: undefined }, { ...input, limits: LIMITS }, { ...input, requestId: "not-a-key" },
    { ...input, expectedState: "A".repeat(64) }, { ...input, expiresAt: RENEWAL_NOW.toISOString() },
    { ...input, expiresAt: new Date(+RENEWAL_NOW + 7200001).toISOString() }, { ...input, expiresAt: END.toISOString() }]) {
    const before = copy(f.data); assert.equal((await f.service.renew(bad)).code, "INVALID_REQUEST"); assert.deepEqual(f.data, before);
  }
  assert.equal((await f.service.renew({ ...input, expiresAt: new Date(+RENEWAL_NOW + 7200000).toISOString() })).ok, true);
});

test("renewal requires explicit private-preview, shopper authentication and organisation gates before reads", async () => {
  for (const [key, value] of [["RUVANAS_RETAIL_REWARDS_ENABLED", "false"], ["RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED", "false"],
    ["RUVANAS_PRIVATE_PREVIEW_ENABLED", "0"], ["RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED", "false"],
    ["RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS", '["other-org"]']]) {
    const f = await expiredRenewalFixture(), input = await renewalInput(f), before = copy(f.data); f.env[key] = value;
    const callCount = f.calls.length;
    assert.equal((await f.service.renewalReview(RENEWAL_REVIEW)).ok, false); assert.equal((await f.service.renew(input)).ok, false);
    assert.equal(f.calls.length, callCount); assert.deepEqual(f.data, before);
  }
});

test("renewal rejects stale row timestamps, limits, subscription and programme pins without writes", async () => {
  for (const change of [d => d.rewardEntitlementGrant[0].updatedAt = NOW, d => d.rewardEntitlementGrant[0].activeOffers++,
    d => d.rewardShopperMembership[0].version++, d => d.rewardProgram[0].updatedAt = NOW,
    d => d.rewardShopper[0].updatedAt = NOW, d => d.organisation[0].subscription.plan.code = "RETAIL_BUSINESS",
    d => d.rewardShopperInvitation[0].tokenHash = "f".repeat(64)]) {
    const f = await expiredRenewalFixture(), input = await renewalInput(f); change(f.data); const before = copy(f.data);
    assert.equal((await f.service.renew(input)).ok, false, String(change)); assert.deepEqual(f.data, before);
  }
});

test("renewal rejects missing, foreign, partially expired or used identities and unexpected tenant access", async () => {
  for (const change of [d => d.rewardShopperSetup.splice(0), d => d.rewardShopperSetup[0].organisationId = "other-org",
    d => d.rewardPilotShopperEnrollment[0].organisationId = "other-org", d => d.auditLog.splice(0),
    d => d.rewardShopper[0].status = "ACTIVE", d => d.rewardShopper[0].authVersion++,
    d => d.rewardShopperInvitation[0].revokedAt = null, d => d.rewardShopperInvitation[0].acceptedAt = NOW,
    d => d.rewardShopperMembership[0].expiresAt = END, d => d.rewardEntitlementGrant[0].expiresAt = END,
    d => d.rewardShopperMembership[0].source = "BILLING", d => d.rewardShopperMembership[0].status = "CANCELLED",
    d => d.rewardEntitlementGrant[0].status = "ACTIVE", d => d.rewardEntitlementGrant[0].revokedAt = NOW,
    d => d.organisation[0].subscription.status = "CANCELLED", d => d.organisation[0].subscription.plan.retailRadioEnabled = false,
    d => d.rewardProgram[0].networkOptIn = false,
    d => d.user.push({ id: "collision", email: PREPARED_INVITE.email.toUpperCase() }),
    d => d.rewardShopperCredential.push({ shopperId: "foreign-shopper", emailCanonical: PREPARED_INVITE.email.toUpperCase() }),
    d => d.rewardShopperInvitation.push({ id: "foreign-invite", shopperId: "foreign-shopper", emailCanonical: PREPARED_INVITE.email.toUpperCase() }),
    d => d.rewardShopperSetup.push({ shopperId: "foreign-shopper", emailCanonical: PREPARED_INVITE.email.toUpperCase() }),
    d => d.rewardPilotShopperEnrollment.push({ organisationId: "org-one", shopperId: "foreign-shopper" }),
    d => d.rewardStaffGrant.push({ organisationId: "org-one" }),
    d => d.rewardOffer.push({ organisationId: "org-one", state: "PUBLISHED", publishedEndsAt: END }),
    ...["rewardShopperCredential", "rewardShopperSession", "rewardClaim", "rewardRedemption"].map(model => d => d[model].push({ shopperId: PREPARED_INVITE.shopperId }))]) {
    const f = await expiredRenewalFixture(), input = await renewalInput(f); change(f.data); const before = copy(f.data);
    assert.equal((await f.service.renewalReview(RENEWAL_REVIEW)).ok, false, String(change));
    assert.equal((await f.service.renew(input)).ok, false, String(change)); assert.deepEqual(f.data, before);
  }
});

test("renewal transaction rolls back partial writes, failed audit, authority revocation and end-of-window drift", async () => {
  for (const change of [(d, f) => { d.context.user.role = "OWNER"; }, (d, f) => { f.env.RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED = "false"; },
    (d, f) => { f.env.RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED = "false"; }, (d, f) => { d.context.session.revokedAt = NOW; },
    (d, f) => { f.now = new Date(RENEWAL_END); }, (d, f) => { f.failAudit = true; }]) {
    const f = await expiredRenewalFixture(), input = await renewalInput(f), before = copy(f.data);
    f.afterWrite = (data, model) => { if (model === "rewardEntitlementGrant") change(data, f); };
    assert.equal((await f.service.renew(input)).ok, false, String(change)); assert.deepEqual(f.data, before);
  }
  const f = await expiredRenewalFixture(), input = await renewalInput(f), before = copy(f.data);
  f.afterWrite = (data, model) => { if (model === "rewardPilotAuditEvent") f.env.RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED = "false"; };
  assert.equal((await f.service.renew(input)).ok, false); assert.deepEqual(f.data, before);
});
