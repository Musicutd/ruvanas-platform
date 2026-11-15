import test from "node:test";
import assert from "node:assert/strict";
import { createRewardOfferService } from "../lib/retail-rewards/offer-service.mjs";

const NOW = new Date("2026-11-14T12:00:00Z"), START = new Date("2026-11-01T00:00:00Z"), END = new Date("2027-01-01T00:00:00Z");
const clone = value => structuredClone(value);
function terms(patch = {}) {
  return { schemaVersion: 1, title: "10% after spending EUR 50", description: "A reusable home offer", category: "HOME",
    type: "PERCENT_OFF", percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null,
    currency: "EUR", minimumSpendMinor: 5000, exclusions: "Gift cards", legalTerms: "Present to authorised shop staff.",
    combinable: false, startsAt: "2026-11-14T00:00:00.000Z", endsAt: "2026-12-14T00:00:00.000Z", timezone: "Europe/Malta",
    locationIds: ["shop-one"], usage: "REUSABLE", totalLimit: 100, perShopperLimit: 10,
    perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED", ...patch };
}
function fixture({ role = "OWNER", env = { RUVANAS_RETAIL_REWARDS_ENABLED: "true" } } = {}) {
  const subscription = { id: "sub-one", organisationId: "org-one", status: "ACTIVE",
    plan: { code: "RETAIL_START", active: true, retailRadioEnabled: true } };
  const member = { id: "member-one", organisationId: "org-one", userId: "user-one", role };
  const context = { user: { id: "user-one", role },
    session: { id: "session-one", userId: "user-one", activeOrganisationId: "org-one", authMethod: "PASSWORD", expiresAt: END, revokedAt: null },
    membership: { ...member, organisation: { id: "org-one", subscription } }, memberships: [{ ...member }] };
  const data = {
    programs: [{ id: "program-one", organisationId: "org-one", status: "ACTIVE" }],
    grants: [{ id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS",
      source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "ACTIVE", startsAt: START, expiresAt: END, revokedAt: null,
      limitsVersion: 1, activeOffers: 2, locations: 2, staffSeats: 3, monthlyRedemptions: 100,
      analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false }],
    staff: [{ id: "grant-staff", organisationId: "org-one", organisationMemberId: "member-one", scope: "LOCATIONS", locationId: "shop-one",
      capabilities: ["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS"], startsAt: START, expiresAt: END, revokedAt: null }],
    locations: [{ id: "shop-one", organisationId: "org-one", name: "Main shop", status: "ACTIVE" },
      { id: "shop-two", organisationId: "org-one", name: "Second shop", status: "ACTIVE" },
      { id: "foreign-shop", organisationId: "other-org", name: "Private other shop", status: "ACTIVE" }],
    offers: [], offerLocations: [], revisions: [], audits: [], campaignDrafts: []
  };
  const calls = [], txOptions = [];
  let clock = NOW, beforeTransaction, onContext, failAudit = false, attempts = 0;
  function matches(row, where = {}, source = data) {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some(condition => matches(row, condition, source));
      if (key === "AND") return value.every(condition => matches(row, condition, source));
      if (key === "locations") {
        const locations = source.offerLocations.filter(location => location.offerId === row.id);
        return (!value.some || locations.some(location => matches(location, value.some, source))) &&
          (!value.every || locations.every(location => matches(location, value.every, source)));
      }
      if (key === "draft") {
        const actual = row.draft[value.path[0]];
        if (value.equals !== undefined) return actual === value.equals;
        return actual.toLowerCase().includes(value.string_contains.toLowerCase());
      }
      if (value instanceof Date) return row[key]?.getTime() === value.getTime();
      if (value !== null && typeof value === "object") {
        if (value.in && !value.in.includes(row[key])) return false;
        if (value.not !== undefined && row[key] === value.not) return false;
        if (value.gt !== undefined && !(row[key] > value.gt)) return false;
        if (value.lte !== undefined && !(row[key] <= value.lte)) return false;
        return true;
      }
      return row[key] === value;
    });
  }
  function project(row, select) {
    return row === undefined ? null : clone(select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : row);
  }
  function client(source, inside = false) {
    function delegate(key) {
      return {
        async findFirst({ where, select } = {}) { calls.push([inside, key, "findFirst", clone(where)]); return project(source[key].find(row => matches(row, where, source)), select); },
        async findMany({ where, select, take, skip = 0, orderBy } = {}) {
          calls.push([inside, key, "findMany", clone(where)]);
          let rows = source[key].filter(row => matches(row, where, source));
          if (orderBy) rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
          return rows.slice(skip, take === undefined ? undefined : skip + take).map(row => project(row, select));
        },
        async count({ where }) { calls.push([inside, key, "count", clone(where)]); return source[key].filter(row => matches(row, where, source)).length; },
        async create({ data: input }) {
          calls.push([inside, key, "create"]);
          if (key === "audits" && failAudit) throw new Error("Sensitive database/credential diagnostic must never escape");
          const row = { id: `generated-${source[key].length}`, publishedRevision: null, publishedStartsAt: null, publishedEndsAt: null,
            createdAt: new Date(clock), updatedAt: new Date(clock), ...clone(input) };
          source[key].push(row); return clone(row);
        },
        async createMany({ data: inputs }) { calls.push([inside, key, "createMany"]); source[key].push(...clone(inputs)); return { count: inputs.length }; },
        async deleteMany({ where }) { calls.push([inside, key, "deleteMany", clone(where)]); const rows = source[key].filter(row => !matches(row, where, source));
          const count = source[key].length - rows.length; source[key] = rows; return { count }; },
        async updateMany({ where, data: changes }) {
          calls.push([inside, key, "updateMany", clone(where)]); let count = 0;
          for (const row of source[key].filter(row => matches(row, where, source))) {
            count += 1;
            for (const [field, value] of Object.entries(changes)) row[field] = value?.increment ? row[field] + value.increment : clone(value);
            row.updatedAt = new Date(clock);
          }
          return { count };
        }
      };
    }
    const offers = delegate("offers");
    function expand(row) {
      if (!row) return row;
      return { ...row, locations: clone(source.offerLocations.filter(location => location.offerId === row.id)),
        revisions: clone(source.revisions.filter(revision => revision.offerId === row.id).sort((a, b) => b.revision - a.revision).slice(0, 1)) };
    }
    return { rewardProgram: delegate("programs"), rewardEntitlementGrant: delegate("grants"), rewardStaffGrant: delegate("staff"),
      location: delegate("locations"), rewardOfferLocation: delegate("offerLocations"), rewardOfferRevision: delegate("revisions"),
      rewardOfferCampaignDraft: delegate("campaignDrafts"), rewardAuditEvent: delegate("audits"), rewardOffer: { ...offers,
        findFirst: async input => expand(await offers.findFirst(input)),
        findMany: async input => (await offers.findMany(input)).map(expand) },
      async $queryRaw(strings, ...values) {
        calls.push([inside, "raw", strings.join("?")]);
        const query = strings.join("");
        if (query.includes("FOR UPDATE")) return source.programs.filter(row => row.organisationId === values[0]).map(({ id }) => ({ id }));
        if (query.includes('FROM "Session"')) return [{ id: context.session.id }];
        if (query.includes('FROM "Location"')) return source.locations.filter(row => row.organisationId === values[0] && JSON.parse(values[1]).includes(row.id)).map(({ id }) => ({ id }));
        if (query.includes('FROM "RewardStaffGrant"')) return source.staff.filter(row => row.organisationId === values[0] && row.organisationMemberId === values[1]).map(({ id }) => ({ id }));
        if (query.includes('FROM "BillingContract"') || query.includes('FROM "EnterpriseSecurityPolicy"')) return [];
        const [organisationId, excluded, now, json] = values;
        const used = source.offers.filter(row => row.organisationId === organisationId && row.id !== excluded &&
          ["PUBLISHED", "PAUSED"].includes(row.state) && row.publishedEndsAt > now).map(row => row.id);
        const locations = source.offerLocations.filter(row => row.organisationId === organisationId && row.scope === "PUBLISHED" && used.includes(row.offerId)).map(row => row.locationId);
        return [{ count: BigInt(new Set([...locations, ...JSON.parse(json)]).size) }];
      }
    };
  }
  const db = { ...client(data), async $transaction(operation, options) {
    attempts += 1; txOptions.push(options); beforeTransaction?.(attempts);
    const snapshot = clone(data), tx = client(snapshot, true);
    const result = await operation(tx);
    for (const key of Object.keys(data)) data[key] = snapshot[key];
    return result;
  } };
  const service = createRewardOfferService({ db, env, clock: () => clock,
    loadContext: async tx => { calls.push(["context", tx !== db]); onContext?.(tx !== db); return context; } });
  return { service, data, context, calls, txOptions, env,
    setClock: value => { clock = value; }, setBeforeTransaction: value => { beforeTransaction = value; },
    setOnContext: value => { onContext = value; }, failAudit: () => { failAudit = true; },
    async create(patch = {}) { const result = await service.create({ terms: terms(patch) }); assert.equal(result.ok, true, JSON.stringify(result)); return result.offer; }
  };
}

test("disabled offer service has zero auth, query or transaction calls", async () => {
  const f = fixture({ env: {} });
  for (const promise of [f.service.list(), f.service.create({}), f.service.update("id", {}), f.service.transition("id", "PUBLISH", {})]) {
    assert.equal((await promise).code, "FEATURE_DISABLED");
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.txOptions, []);
});

test("strict requests reject tenant/actor injection before auth and writes", async () => {
  const f = fixture();
  assert.equal((await f.service.create({ terms: terms(), organisationId: "other-org" })).code, "INVALID_REQUEST");
  assert.equal((await f.service.update("offer", { expectedVersion: 1, terms: terms(), actorUserId: "owner" })).code, "INVALID_REQUEST");
  assert.equal((await f.service.list({ page: 1, organisationId: "other-org" })).code, "INVALID_REQUEST");
  assert.equal((await f.service.transition("../id", "PUBLISH", { expectedVersion: 1 })).code, "INVALID_REQUEST");
  assert.deepEqual(f.calls, []); assert.deepEqual(f.txOptions, []);
});

test("create/save/publish retain immutable published terms and atomic audit", async () => {
  const f = fixture(), draft = await f.create();
  assert.equal(draft.displayState, "DRAFT"); assert.equal(draft.publishedTerms, null);
  const published = await f.service.transition(draft.id, "PUBLISH", { expectedVersion: draft.version });
  assert.equal(published.ok, true); assert.equal(published.offer.displayState, "ACTIVE");
  assert.equal(published.offer.publishedRevision, 1);
  const edited = await f.service.update(draft.id, { expectedVersion: published.offer.version, terms: terms({ percentBps: 1500, locationIds: ["shop-two"] }) });
  assert.equal(edited.ok, true); assert.equal(edited.offer.draft.percentBps, 1500);
  assert.equal(edited.offer.publishedTerms.percentBps, 1000);
  assert.deepEqual(edited.offer.publishedTerms.locationIds, ["shop-one"]);
  assert.equal(f.data.revisions.length, 1);
  assert.deepEqual(f.data.audits.map(row => row.action), ["OFFER_CREATED", "OFFER_PUBLISHED", "OFFER_DRAFT_SAVED"]);
  assert.ok(f.txOptions.every(value => value.isolationLevel === "Serializable"));
  assert.ok(f.calls.filter(row => row[0] === "context").every(row => row[1] === true));
});

test("stale edit or duplicate publication cannot mutate the offer or append evidence", async () => {
  const f = fixture(), draft = await f.create();
  const published = await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 1 });
  assert.equal(published.ok, true);
  const before = clone(f.data);
  assert.equal((await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 1 })).code, "CONFLICT");
  assert.equal((await f.service.update(draft.id, { expectedVersion: 1, terms: terms({ title: "stale" }) })).code, "CONFLICT");
  assert.deepEqual(f.data, before);
});

test("foreign, missing and partially scoped offers are indistinguishable", async () => {
  const f = fixture(), draft = await f.create({ locationIds: ["shop-one", "shop-two"] });
  f.context.membership.role = "MANAGER"; f.context.memberships[0].role = "MANAGER";
  const input = { expectedVersion: draft.version, terms: terms() };
  for (const id of [draft.id, "missing", "other-tenant-offer"]) assert.equal((await f.service.update(id, input)).code, "OFFER_UNAVAILABLE");
  const list = await f.service.list(); assert.equal(list.ok, true); assert.deepEqual(list.offers, []);
  assert.equal(f.data.audits.length, 1);
});

test("an editor cannot publish or cancel and cannot create for a foreign shop", async () => {
  const f = fixture({ role: "CONTENT_EDITOR" }), draft = await f.create();
  for (const action of ["PUBLISH", "CANCEL", "PAUSE", "RESUME"]) assert.equal((await f.service.transition(draft.id, action, { expectedVersion: 1 })).code, "FORBIDDEN");
  assert.equal((await f.service.create({ terms: terms({ locationIds: ["foreign-shop"] }) })).code, "LOCATION_UNAVAILABLE");
  assert.equal(f.data.offers.length, 1); assert.equal(f.data.revisions.length, 0);
});

test("publication requires scope over the live target as well as the edited draft", async () => {
  const f = fixture(), draft = await f.create({ locationIds: ["shop-two"] });
  const published = await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 1 });
  assert.equal(published.ok, true);
  const edited = await f.service.update(draft.id, { expectedVersion: 2, terms: terms() });
  assert.equal(edited.ok, true);
  f.context.membership.role = "MANAGER"; f.context.memberships[0].role = "MANAGER";
  assert.equal((await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 3 })).code, "OFFER_UNAVAILABLE");
  assert.deepEqual((await f.service.list()).offers, []);
});

test("pause reserves capacity and resume preserves published revision despite unsaved publication", async () => {
  const f = fixture(), draft = await f.create(); f.data.grants[0].activeOffers = 1;
  assert.equal((await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 1 })).ok, true);
  assert.equal((await f.service.transition(draft.id, "PAUSE", { expectedVersion: 2 })).ok, true);
  const second = await f.create({ title: "Another" });
  assert.equal((await f.service.transition(second.id, "PUBLISH", { expectedVersion: 1 })).code, "LIMIT_REACHED");
  assert.equal((await f.service.update(draft.id, { expectedVersion: 3, terms: terms({ percentBps: 1500 }) })).ok, true);
  const resumed = await f.service.transition(draft.id, "RESUME", { expectedVersion: 4 });
  assert.equal(resumed.ok, true); assert.equal(resumed.offer.publishedRevision, 1);
  assert.equal(resumed.offer.publishedTerms.percentBps, 1000); assert.equal(resumed.offer.draft.percentBps, 1500);
});

test("location quota counts the union of all reserved offers and cancellation frees it", async () => {
  const f = fixture(), first = await f.create(); f.data.grants[0].locations = 1;
  assert.equal((await f.service.transition(first.id, "PUBLISH", { expectedVersion: 1 })).ok, true);
  const second = await f.create({ locationIds: ["shop-two"] });
  assert.equal((await f.service.transition(second.id, "PUBLISH", { expectedVersion: 1 })).code, "LIMIT_REACHED");
  assert.equal((await f.service.transition(first.id, "CANCEL", { expectedVersion: 2 })).ok, true);
  assert.equal((await f.service.transition(second.id, "PUBLISH", { expectedVersion: 1 })).ok, true);
  assert.equal(f.data.revisions.length, 2);
});

test("closed shops block publication but do not prevent pausing or cancelling", async () => {
  const f = fixture(), draft = await f.create();
  assert.equal((await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 1 })).ok, true);
  f.data.locations[0].status = "CLOSED";
  assert.equal((await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 2 })).code, "LOCATION_UNAVAILABLE");
  assert.equal((await f.service.transition(draft.id, "PAUSE", { expectedVersion: 2 })).ok, true);
  assert.equal((await f.service.transition(draft.id, "RESUME", { expectedVersion: 3 })).code, "LOCATION_UNAVAILABLE");
  assert.equal((await f.service.transition(draft.id, "CANCEL", { expectedVersion: 3 })).ok, true);
});

test("fresh transactional authority rejects revoked membership and expired session", async () => {
  const f = fixture();
  f.setBeforeTransaction(() => { f.context.memberships = []; });
  assert.equal((await f.service.create({ terms: terms() })).code, "FORBIDDEN");
  assert.equal(f.data.offers.length, 0);
  const expired = fixture(); expired.setClock(END);
  assert.equal((await expired.service.create({ terms: terms() })).code, "UNAUTHENTICATED");
  assert.equal(expired.data.offers.length, 0);
});

test("authority or feature loss at the final check rolls back offer and audit", async () => {
  for (const mutate of [f => { f.env.RUVANAS_RETAIL_REWARDS_ENABLED = "false"; },
    f => { f.context.session.revokedAt = NOW; }]) {
    const f = fixture(); let checks = 0;
    f.setOnContext(() => { checks += 1; if (checks === 3) mutate(f); });
    assert.equal((await f.service.create({ terms: terms() })).ok, false);
    assert.equal(f.data.offers.length, 0); assert.equal(f.data.audits.length, 0);
  }
});

test("audit failure rolls back all changes and leaks no database error", async () => {
  const f = fixture(); f.failAudit();
  const result = await f.service.create({ terms: terms() });
  assert.equal(result.code, "UNAVAILABLE"); assert.doesNotMatch(JSON.stringify(result), /Sensitive|credential|database/);
  assert.equal(f.data.offers.length, 0); assert.equal(f.data.offerLocations.length, 0);
});

test("expired terms cannot publish; scheduled/active list filters use published dates", async () => {
  const f = fixture(), draft = await f.create({ endsAt: "2026-11-14T01:00:00.000Z" });
  assert.equal((await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 1 })).code, "INVALID_REQUEST");
  const scheduled = await f.create({ title: "Holiday fashion", category: "FASHION", startsAt: "2026-12-01T00:00:00.000Z" });
  assert.equal((await f.service.transition(scheduled.id, "PUBLISH", { expectedVersion: 1 })).offer.displayState, "SCHEDULED");
  const result = await f.service.list({ search: "HOLIDAY", category: "FASHION", state: "SCHEDULED" });
  assert.equal(result.ok, true); assert.equal(result.offers.length, 1); assert.equal(result.offers[0].id, scheduled.id);
  assert.equal((await f.service.list({ state: "ACTIVE" })).offers.length, 0);
});

test("serialization failures are retried in a fresh bounded transaction", async () => {
  const f = fixture(); f.setBeforeTransaction(attempt => { if (attempt < 3) throw Object.assign(new Error("serialize"), { code: "P2034" }); });
  const result = await f.service.create({ terms: terms() });
  assert.equal(result.ok, true); assert.equal(f.txOptions.length, 3); assert.equal(f.data.offers.length, 1);
  const exhausted = fixture(); exhausted.setBeforeTransaction(() => { throw Object.assign(new Error("serialize"), { code: "P2034" }); });
  assert.equal((await exhausted.service.create({ terms: terms() })).code, "CONFLICT");
  assert.equal(exhausted.txOptions.length, 3); assert.equal(exhausted.data.offers.length, 0);
});

test("list does not return data when the final read authority expires or changes tenant", async () => {
  const f = fixture(); await f.create();
  let checks = 0;
  f.setOnContext(() => { checks += 1; if (checks === 4) f.context.session.revokedAt = NOW; });
  const result = await f.service.list();
  assert.equal(result.code, "UNAUTHENTICATED");
  assert.equal(Object.hasOwn(result, "offers"), false);
});

test("cancelled offers retain evidence and cannot be edited or resurrected", async () => {
  const f = fixture(), draft = await f.create();
  assert.equal((await f.service.transition(draft.id, "PUBLISH", { expectedVersion: 1 })).ok, true);
  assert.equal((await f.service.transition(draft.id, "CANCEL", { expectedVersion: 2 })).ok, true);
  const before = clone(f.data);
  for (const action of ["PUBLISH", "PAUSE", "RESUME", "CANCEL"]) {
    assert.equal((await f.service.transition(draft.id, action, { expectedVersion: 3 })).code, "CONFLICT");
  }
  assert.equal((await f.service.update(draft.id, { expectedVersion: 3, terms: terms() })).code, "CONFLICT");
  assert.deepEqual(f.data, before);
  assert.equal((await f.service.list({ state: "CANCELLED" })).offers[0].publishedRevision, 1);
});
