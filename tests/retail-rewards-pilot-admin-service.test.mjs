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
    rewardProgram: prepared ? [{ id: "program-one", organisationId: "org-one", status: "ACTIVE", networkOptIn: true, timezone: "Europe/Malta" }] : [],
    rewardEntitlementGrant: prepared ? [{ id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL",
      tier: "REWARDS_STARTER", status: "TRIAL", startsAt: START, expiresAt: END, revokedAt: null, limitsVersion: 1, ...LIMITS }] : [],
    rewardPublicShopProfile: [], rewardOffer: [], rewardOfferDiscovery: [], rewardShopper: [], rewardShopperCredential: [],
    rewardShopperMembership: [], rewardShopperInvitation: [], rewardPilotShopperEnrollment: [], rewardPilotAuditEvent: []
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
        const row = { id: `${model}-${++serial}`, revokedAt: null, acceptedAt: null, createdAt: current, ...copy(args.data) };
        data[model].push(row); afterWrite?.(data, model); return project(hydrated(model, row, data), args.select);
      },
      async update(args) { calls.push({ model, method: "update" }); const row = data[model].find(r => matches(r, args.where));
        if (!row) throw new Error("Missing synthetic row"); Object.assign(row, copy(args.data)); afterWrite?.(data, model); return project(row, args.select); },
      async upsert(args) { const row = data[model].find(r => matches(r, args.where));
        if (row) return result[model].update({ where: args.where, data: args.update, select: args.select });
        return result[model].create({ data: args.create, select: args.select }); }
    };
    result.$queryRaw = async (parts, ...values) => {
      const sql = parts.join("?"); calls.push({ model: "lock", sql, values });
      if (sql.includes('FROM "User"')) return data.context.user.id === values[0] ? [{ id: values[0] }] : [];
      if (sql.includes('FROM "Session"')) return data.context.session.id === values[0] && data.context.session.userId === values[1] ? [{ id: values[0] }] : [];
      if (sql.includes('FROM "PrivatePreviewAccess"')) return data.context.user.privatePreviewAccess?.userId === values[0] ? [{ userId: values[0] }] : [];
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
