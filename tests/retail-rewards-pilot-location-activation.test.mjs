import test from "node:test";
import assert from "node:assert/strict";
import { activateRewardPilotLocation } from "../lib/retail-rewards/pilot-location-activation.mjs";
import { resolveRewardsEntitlements } from "../lib/retail-rewards/entitlements.mjs";

const NOW = new Date("2026-11-18T12:00:00.000Z"), END = new Date("2026-11-18T14:00:00.000Z");
const INPUT = { organisationId: "test-org", locationId: "test-shop", confirm: true };
const IDENTITY = { organisationId: "test-org", userId: "test-super-admin" };
const copy = value => structuredClone(value);
const abort = code => { const error = new Error(code); error.code = code; throw error; };

function fixture() {
  let source = {
    locations: [{ id: "test-shop", organisationId: "test-org", status: "DRAFT",
      correctionsFacility: null, name: "Unchanged shop", timezone: "Europe/Malta", city: null }],
    zones: [{ id: "zone-one", locationId: "test-shop", name: "Main Store", status: "ACTIVE" }],
    assignments: [], players: [], displays: [], audits: [],
    state: {
      subscription: { id: "test-sub", organisationId: "test-org", status: "ACTIVE",
        plan: { active: true, code: "RETAIL_START", productFamily: "RETAIL", retailRadioEnabled: true, stationLimit: 1 } },
      program: { id: "test-program", organisationId: "test-org", status: "ACTIVE", networkOptIn: true },
      grant: { id: "test-grant", organisationId: "test-org", subscriptionId: "test-sub", capability: "RETAIL_REWARDS",
        source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "TRIAL", startsAt: NOW, expiresAt: END, revokedAt: null,
        limits: { activeOffers: 3, locations: 1, staffSeats: 1, monthlyRedemptions: 4, analyticsRetentionDays: 7, exportEnabled: false, brandingEnabled: false } }
    }
  };
  let instant = NOW, afterAudit, failAudit = false, conflict = false, badCount = false, afterCount;
  const calls = [];
  const belongs = (row, data) => data.zones.some(z => z.locationId === INPUT.locationId && z.id === row.zoneId);
  async function run(input = INPUT, identity = IDENTITY) {
    const working = copy(source);
    const tx = {
      $queryRaw: async (strings, ...values) => {
        const sql = strings.join("?"); calls.push({ operation: "lock", sql, values });
        if (sql.includes('FROM "Location"') && sql.includes('LIMIT 1001 FOR SHARE')) return working.locations
          .filter(l => l.organisationId === values[0]).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1001).map(l => ({ id: l.id }));
        if (sql.includes('FROM "Location"')) return working.locations.filter(l => l.id === values[0] && l.organisationId === values[1]).map(l => ({ id: l.id }));
        if (sql.includes('FROM "Zone"')) return working.zones.filter(z => z.locationId === values[0]).slice(0, 1001).map(z => ({ id: z.id }));
        throw new Error("Unexpected lock");
      },
      location: {
        findFirst: async ({ where }) => copy(working.locations.find(l => l.id === where.id && l.organisationId === where.organisationId) || null),
        count: async ({ where }) => {
          if (badCount) return NaN;
          const rows = working.locations.filter(l => l.organisationId === where.organisationId && !l.correctionsFacility &&
            (where.status.not ? l.status !== where.status.not : where.status.in.includes(l.status)));
          afterCount?.(working);
          return rows.length;
        },
        updateMany: async ({ where, data }) => {
          calls.push({ operation: "update", where: copy(where), data: copy(data) });
          if (conflict) return { count: 0 };
          const rows = working.locations.filter(l => l.id === where.id && l.organisationId === where.organisationId && l.status === where.status && !l.correctionsFacility);
          rows.forEach(l => Object.assign(l, data));
          return { count: rows.length };
        }
      },
      channelAssignment: { count: async () => working.assignments.filter(a => belongs(a, working)).length },
      player: { count: async () => working.players.filter(a => belongs(a, working)).length },
      digitalSignageDevice: { count: async () => working.displays.filter(a => belongs(a, working)).length },
      auditLog: { create: async ({ data }) => {
        if (failAudit) throw new Error("Synthetic audit failure");
        working.audits.push(copy(data)); afterAudit?.(working);
        return { id: "audit-one" };
      } }
    };
    try {
      const result = await activateRewardPilotLocation({
        tx, input, identity, now: NOW, abort,
        readState: async (_tx, org) => {
          assert.equal(_tx, tx); assert.equal(org, "test-org"); return copy(working.state);
        },
        entitled: (state, organisationId, now) => {
          const result = resolveRewardsEntitlements({ organisationId, subscription: state.subscription,
            program: state.program && { id: state.program.id, organisationId: state.program.organisationId, status: state.program.status },
            grant: state.grant, action: "READ", now });
          if (!result.allowed || state.program.networkOptIn !== true) abort("NOT_ENTITLED");
          return state.grant;
        },
        nowAt: () => new Date(instant)
      });
      source = working; return result;
    } catch (error) { return { ok: false, code: error.code || "UNAVAILABLE" }; }
  }
  return { run, calls, get data() { return source; }, set now(value) { instant = value; },
    set afterAudit(value) { afterAudit = value; }, set afterCount(value) { afterCount = value; },
    set failAudit(value) { failAudit = value; }, set conflict(value) { conflict = value; }, set badCount(value) { badCount = value; } };
}

const denied = (result, code) => assert.deepEqual(result, { ok: false, code });

test("Rewards-only activation changes only exact DRAFT status and appends one ordinary audit", async () => {
  const f = fixture(), before = copy(f.data);
  f.data.locations.push({ id: "foreign-shop", organisationId: "foreign-org", status: "DRAFT", correctionsFacility: null });
  const foreign = copy(f.data.locations[1]);
  assert.deepEqual(await f.run(), { ok: true, locationId: "test-shop", status: "ACTIVE" });
  assert.deepEqual(f.data.locations[0], { ...before.locations[0], status: "ACTIVE" });
  assert.deepEqual(f.data.locations[1], foreign);
  assert.deepEqual(f.data.zones, before.zones);
  assert.deepEqual([f.data.assignments, f.data.players, f.data.displays, f.data.state], [[], [], [], before.state]);
  assert.deepEqual(f.data.audits, [{ organisationId: "test-org", actorUserId: "test-super-admin",
    action: "REWARDS_PILOT_LOCATION_ACTIVATED", entityType: "Location", entityId: "test-shop",
    details: { previousStatus: "DRAFT", status: "ACTIVE", purpose: "REWARDS_ONLY", audioChanged: false } }]);
  const locks = f.calls.filter(c => c.operation === "lock");
  assert.match(locks[0].sql, /ORDER BY "id" LIMIT 1001 FOR SHARE/); assert.deepEqual(locks[0].values, ["test-org"]);
  assert.match(locks[1].sql, /FOR UPDATE/); assert.deepEqual(locks[1].values, ["test-shop", "test-org"]);
  assert.match(locks[2].sql, /ORDER BY "id" LIMIT 1001 FOR UPDATE/);
});

test("an ACTIVE retry remains guarded and produces no second write or audit", async () => {
  const f = fixture(); await f.run(); const writes = f.calls.filter(c => c.operation === "update").length;
  assert.deepEqual(await f.run(), { ok: true, locationId: "test-shop", status: "ACTIVE" });
  assert.equal(f.data.audits.length, 1); assert.equal(f.calls.filter(c => c.operation === "update").length, writes);
  f.data.state.grant.revokedAt = NOW;
  denied(await f.run(), "NOT_ENTITLED");
});

test("input confirmation and actor tenant are required before any database access", async () => {
  for (const [input, identity] of [[{ ...INPUT, confirm: false }, IDENTITY], [{ ...INPUT, locationId: "../shop" }, IDENTITY],
    [INPUT, { ...IDENTITY, organisationId: "other-org" }], [INPUT, { ...IDENTITY, userId: "" }]]) {
    const f = fixture(); denied(await f.run(input, identity), "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
  }
});

test("missing, foreign, CLOSED and PAUSED locations share the unavailable result", async () => {
  for (const change of [
    f => { f.data.locations = []; },
    f => { f.data.locations[0].organisationId = "foreign-org"; },
    f => { f.data.locations[0].status = "CLOSED"; },
    f => { f.data.locations[0].status = "PAUSED"; },
    f => { f.data.locations[0].correctionsFacility = { id: "facility" }; }
  ]) {
    const f = fixture(); change(f); const before = copy(f.data);
    denied(await f.run(), "LOCATION_UNAVAILABLE"); assert.deepEqual(f.data, before);
  }
});

for (const [collection, row] of [
  ["assignments", { zoneId: "zone-one", activeTo: new Date("2020-01-01") }],
  ["players", { zoneId: "zone-one", status: "DISABLED", retiredAt: NOW }],
  ["displays", { zoneId: "zone-one", status: "DISABLED" }]
]) test(`existing ${collection}, including inactive history, cannot be enabled through Rewards`, async () => {
  const f = fixture(); f.data[collection].push(row); const before = copy(f.data);
  denied(await f.run(), "CONFLICT"); assert.deepEqual(f.data, before);
});

test("a draft already consumes one physical site; equal allowance is permitted without increasing limits", async () => {
  const f = fixture(); assert.equal(f.data.state.subscription.plan.stationLimit, 1);
  assert.equal((await f.run()).ok, true);
  assert.equal(f.data.state.subscription.plan.stationLimit, 1);
});

test("over-capacity drafts and paused sites do not bypass physical or Rewards allowance", async () => {
  const physical = fixture();
  physical.data.locations.push({ id: "second-draft", organisationId: "test-org", status: "DRAFT", correctionsFacility: null });
  denied(await physical.run(), "LIMIT_REACHED");
  for (const status of ["ACTIVE", "PAUSED"]) {
    const f = fixture(); f.data.state.subscription.plan.stationLimit = 2;
    f.data.locations.push({ id: "second-site", organisationId: "test-org", status, correctionsFacility: null });
    denied(await f.run(), "LIMIT_REACHED"); assert.equal(f.data.locations[0].status, "DRAFT");
  }
});

test("inactive subscription, zero grant capacity, revoked grant and expired grant refuse the transition", async () => {
  for (const change of [
    f => { f.data.state.subscription.status = "CANCELLED"; },
    f => { f.data.state.grant.limits.locations = 0; },
    f => { f.data.state.grant.revokedAt = NOW; },
    f => { f.data.state.grant.expiresAt = NOW; },
    f => { f.data.state.program.networkOptIn = false; },
    f => { f.data.state.subscription.plan.stationLimit = "1"; }
  ]) {
    const f = fixture(); change(f); denied(await f.run(), "NOT_ENTITLED"); assert.equal(f.data.locations[0].status, "DRAFT");
  }
});

test("expiry during counts is checked against the fresh clock", async () => {
  const f = fixture(); f.afterCount = () => { f.now = END; };
  denied(await f.run(), "NOT_ENTITLED"); assert.equal(f.data.locations[0].status, "DRAFT"); assert.equal(f.data.audits.length, 0);
});

test("grant expiry or revocation after the audit rolls the transition and audit back", async () => {
  for (const mutate of [
    f => { f.afterAudit = () => { f.now = END; }; },
    f => { f.afterAudit = data => { data.state.grant.revokedAt = NOW; }; }
  ]) {
    const f = fixture(); mutate(f); const before = copy(f.data);
    denied(await f.run(), "NOT_ENTITLED"); assert.deepEqual(f.data, before);
  }
});

test("failed audit and conditional-write conflict leave the location unchanged", async () => {
  for (const [property, code] of [["failAudit", "UNAVAILABLE"], ["conflict", "CONFLICT"]]) {
    const f = fixture(); f[property] = true; const before = copy(f.data);
    denied(await f.run(), code); assert.deepEqual(f.data, before);
  }
});

test("malformed counts and oversized zone sets fail closed", async () => {
  const count = fixture(); count.badCount = true; denied(await count.run(), "UNAVAILABLE");
  const zones = fixture(); zones.data.zones = Array.from({ length: 1001 }, (_, i) => ({ id: `zone-${i}`, locationId: "test-shop" }));
  denied(await zones.run(), "REVIEW_TOO_LARGE");
});

test("bounded tenant metadata locks refuse oversized tenants without touching target or delivery rows", async () => {
  const f = fixture();
  f.data.locations.push(...Array.from({ length: 1000 }, (_, i) => ({ id: `other-location-${i}`, organisationId: "test-org", status: "CLOSED", correctionsFacility: null })));
  const before = copy(f.data);
  denied(await f.run(), "REVIEW_TOO_LARGE"); assert.deepEqual(f.data, before);
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].sql, /LIMIT 1001 FOR SHARE/);
  assert.deepEqual(f.calls[0].values, ["test-org"]);
});

test("tenant row lock bound excludes other organisations", async () => {
  const f = fixture();
  f.data.locations.push(...Array.from({ length: 1001 }, (_, i) => ({ id: `foreign-location-${i}`, organisationId: "foreign-org", status: "ACTIVE", correctionsFacility: null })));
  const foreign = copy(f.data.locations.slice(1));
  assert.equal((await f.run()).ok, true); assert.deepEqual(f.data.locations.slice(1), foreign);
});

test("a Rewards location does not need an audio zone or an assignment", async () => {
  const f = fixture(); f.data.zones = [];
  assert.equal((await f.run()).ok, true); assert.deepEqual(f.data.zones, []); assert.deepEqual(f.data.assignments, []);
});
