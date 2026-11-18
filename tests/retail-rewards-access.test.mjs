import test from "node:test";
import assert from "node:assert/strict";
import { requireRetailRewardsAccess } from "../lib/retail-rewards/access.mjs";
import { REWARDS_ACTIONS } from "../lib/retail-rewards/contracts.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";

const NOW = new Date("2026-11-13T10:00:00.000Z");
const START = new Date("2026-11-01T00:00:00.000Z");
const END = new Date("2026-12-01T00:00:00.000Z");

function fixture(role = "OWNER") {
  const subscription = { id: "sub-one", organisationId: "org-one", status: "ACTIVE", plan: { code: "RETAIL_START", active: true, retailRadioEnabled: true } };
  const member = { id: "member-one", organisationId: "org-one", userId: "user-one", role };
  const context = {
    user: { id: "user-one", role: "OWNER" },
    session: { id: "session-one", userId: "user-one", activeOrganisationId: "org-one", authMethod: "PASSWORD", expiresAt: END, revokedAt: null },
    membership: { ...member, organisation: { id: "org-one", subscription } },
    memberships: [{ ...member }]
  };
  const state = {
    grant: { id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "ACTIVE", startsAt: START, expiresAt: END, revokedAt: null,
      limits: { activeOffers: 2, locations: 2, staffSeats: 3, monthlyRedemptions: 10, analyticsRetentionDays: 30, exportEnabled: true, brandingEnabled: false } },
    program: { id: "program-one", organisationId: "org-one", status: "ACTIVE" }
  };
  const staff = [{ id: "staff-one", organisationId: "org-one", organisationMemberId: "member-one", capabilities: [...REWARDS_ACTIONS], scope: "LOCATIONS", locationIds: ["shop-one"], startsAt: START, expiresAt: END, revokedAt: null }];
  const location = { id: "shop-one", organisationId: "org-one", status: "ACTIVE" };
  const calls = [];
  const dependencies = {
    env: { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, clock: () => NOW,
    loadContext: async () => { calls.push(["context"]); return context; },
    loadRewardsState: async (scope) => { calls.push(["state", scope]); return state; },
    loadStaffGrants: async (scope) => { calls.push(["staff", scope]); return staff; },
    loadLocation: async (scope) => { calls.push(["location", scope]); return location; }
  };
  return { subscription, context, state, staff, location, calls, dependencies };
}
const read = (f) => requireRetailRewardsAccess({ action: "READ" }, f.dependencies);
const redeem = (f, locationId = "shop-one") => requireRetailRewardsAccess({ action: "REDEEM", locationId }, f.dependencies);

test("disabled Rewards performs no context, grant or location reads", async () => {
  for (const env of [{}, { RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { RUVANAS_RETAIL_REWARDS_ENABLED: true }, { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "invalid" }]) {
    const f = fixture();
    f.dependencies.env = env;
    assert.equal((await redeem(f)).code, "FEATURE_DISABLED");
    assert.deepEqual(f.calls, []);
  }
  assert.equal((await requireRetailRewardsAccess({ action: "READ" })).code, "FEATURE_DISABLED");
});

test("malformed actions and tenant overrides are rejected before loading context", async () => {
  for (const input of [null, {}, { action: "read" }, { action: "READ", organisationId: "org-other" }, { action: "READ", locationId: "../shop" }, { action: "READ", locationId: "" }, { action: "REDEEM" }, { action: "REVERSE" }]) {
    const f = fixture();
    assert.equal((await requireRetailRewardsAccess(input, f.dependencies)).code, "INVALID_REQUEST");
    assert.deepEqual(f.calls, []);
  }
});

test("owner access requires an exact current active membership, even for Super Admin", async () => {
  for (const mutate of [
    f => { f.context.membership = null; },
    f => { f.context.memberships = []; },
    f => { f.context.memberships[0].role = "VIEWER"; },
    f => { f.context.memberships[0].id = "stale-member"; },
    f => { f.context.memberships[0].userId = "someone-else"; },
    f => { f.context.memberships.push({ ...f.context.memberships[0], id: "duplicate" }); },
    f => { f.context.session.activeOrganisationId = "org-other"; },
    f => { f.context.membership.organisationId = "org-other"; },
    f => { f.context.membership.role = "STUDENT"; }
  ]) {
    const f = fixture();
    f.context.user.role = "SUPER_ADMIN";
    mutate(f);
    assert.equal((await read(f)).code, "FORBIDDEN");
    assert.deepEqual(f.calls, [["context"]]);
  }
  const f = fixture();
  f.context.user.role = "SUPER_ADMIN";
  f.context.memberships.push({ id: "member-other", userId: "user-one", organisationId: "org-other", role: "OWNER" });
  assert.equal((await read(f)).organisationId, "org-one");
});

test("an unrelated School or support membership does not change selected Retail authority", async () => {
  for (const role of ["STUDENT", "SUPPORT", "SUPER_ADMIN"]) {
    const f = fixture();
    f.context.memberships.push({ id: "member-other", userId: "user-one", organisationId: "org-other", role });
    assert.equal((await read(f)).organisationId, "org-one");
    f.context.membership.role = role;
    f.context.memberships[0].role = role;
    assert.equal((await read(f)).code, "FORBIDDEN");
  }
});

test("missing, revoked, expired and preview sessions receive no Rewards access", async () => {
  for (const mutate of [
    f => { f.context.session = null; },
    f => { f.context.user = null; },
    f => { f.context.session.userId = "different-user"; },
    f => { f.context.session.revokedAt = NOW; },
    f => { f.context.session.expiresAt = NOW; },
    f => { f.context.session.expiresAt = new Date(NaN); },
    f => { f.context.session.expiresAt = END.toISOString(); },
    f => { delete f.context.session.revokedAt; },
    f => { f.context.session.authMethod = "PREVIEW_PASSWORD"; },
    f => { f.context.session.authMethod = "PREVIEW_CODE"; },
    f => { f.context.session.authMethod = "API_KEY"; }
  ]) {
    const f = fixture(); mutate(f);
    assert.equal((await read(f)).code, "UNAUTHENTICATED");
    assert.deepEqual(f.calls, [["context"]]);
  }
  const f = fixture(); f.context.user.privatePreviewAccess = { subscriberTestingEnabled: true };
  assert.equal((await read(f)).code, "FORBIDDEN");
  const sso = fixture(); sso.context.session.authMethod = "SSO";
  assert.equal((await read(sso)).ok, true);
});

test("tenant and subscription links fail closed without changing core entitlements", async () => {
  for (const mutate of [
    f => { f.state.grant = null; },
    f => { f.state.program = null; },
    f => { f.state.grant.organisationId = "org-other"; },
    f => { f.state.program.organisationId = "org-other"; },
    f => { f.state.grant.subscriptionId = "sub-other"; },
    f => { f.context.membership.organisation.id = "org-other"; },
    f => { f.subscription.organisationId = "org-other"; },
    f => { f.subscription.plan.retailRadioEnabled = false; },
    f => { f.state.grant.revokedAt = NOW; },
    f => { f.state.grant.expiresAt = NOW; }
  ]) {
    const f = fixture(); mutate(f);
    const original = structuredClone({ context: f.context, state: f.state });
    const core = resolveEntitlements(f.subscription, NOW);
    assert.equal((await read(f)).code, "NOT_ENTITLED");
    assert.deepEqual({ context: f.context, state: f.state }, original);
    assert.deepEqual(resolveEntitlements(f.subscription, NOW), core);
  }
});

test("each role has a ceiling and non-owners also need explicit action grants", async () => {
  const allowed = {
    OWNER: REWARDS_ACTIONS,
    MANAGER: REWARDS_ACTIONS.filter(action => action !== "MANAGE_STAFF"),
    CONTENT_EDITOR: ["READ", "MANAGE_OFFERS", "VIEW_INSIGHTS"],
    VIEWER: ["READ", "REDEEM"]
  };
  for (const [role, actions] of Object.entries(allowed)) {
    for (const action of REWARDS_ACTIONS) {
      const f = fixture(role);
      const result = await requireRetailRewardsAccess({ action, locationId: "shop-one" }, f.dependencies);
      assert.equal(result.ok, actions.includes(action), `${role}: ${action}`);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
    if (role !== "OWNER") {
      const f = fixture(role); f.staff.length = 0;
      assert.equal((await read(f)).code, "FORBIDDEN");
      const emptySeats = fixture(role); emptySeats.state.grant.limits.staffSeats = 0;
      assert.equal((await read(emptySeats)).code, "FORBIDDEN");
    }
  }
});

test("scopes are action-specific and combine only explicitly granted locations", async () => {
  const f = fixture("VIEWER");
  f.staff[0].capabilities = ["REDEEM"];
  f.staff.push({ ...f.staff[0], id: "read-everywhere", capabilities: ["READ"], scope: "ALL_LOCATIONS", locationIds: [] });
  assert.deepEqual((await read(f)).locationScope, { kind: "ALL_LOCATIONS", locationIds: [] });
  assert.deepEqual((await redeem(f)).locationScope, { kind: "LOCATIONS", locationIds: ["shop-one"] });
  assert.equal((await redeem(f, "shop-other")).code, "LOCATION_UNAVAILABLE");
  assert.equal(f.calls.filter(call => call[0] === "location").length, 1);
  f.staff.push({ ...f.staff[0], id: "second-shop", locationIds: ["shop-two"] });
  f.location.id = "shop-two";
  assert.deepEqual((await redeem(f, "shop-two")).locationScope, { kind: "LOCATIONS", locationIds: ["shop-one", "shop-two"] });
});

test("foreign, duplicate and malformed staff grants cannot widen access", async () => {
  for (const mutate of [
    f => { f.staff[0].organisationId = "org-other"; },
    f => { f.staff[0].organisationMemberId = "member-other"; },
    f => { f.staff.push({ ...f.staff[0] }); },
    f => { f.staff[0].scope = "ALL_LOCATIONS"; },
    f => { f.staff[0].locationIds = []; },
    f => { f.staff[0].capabilities = ["READ", "READ"]; },
    f => { f.staff[0].revokedAt = NOW; },
    f => { f.staff[0].expiresAt = NOW; },
    f => { f.staff[0].startsAt = new Date(NOW.getTime() + 1); },
    f => { f.staff[0].capabilities = ["EXPORT"]; },
    f => { f.staff[0].unlimited = true; }
  ]) {
    const f = fixture("MANAGER"); mutate(f);
    assert.equal((await read(f)).code, "FORBIDDEN");
  }
});

test("explicit locations must exist, be active and belong to the exact tenant", async () => {
  for (const value of [null, { id: "shop-other", organisationId: "org-one", status: "ACTIVE" }, { id: "shop-one", organisationId: "org-other", status: "ACTIVE" }, ...["DRAFT", "PAUSED", "CLOSED"].map(status => ({ id: "shop-one", organisationId: "org-one", status }))]) {
    const f = fixture(); f.dependencies.loadLocation = async () => value;
    const result = await redeem(f);
    assert.equal(result.code, "LOCATION_UNAVAILABLE");
    assert.equal(JSON.stringify(result).includes("org-other"), false);
  }
  const f = fixture("MANAGER"); await redeem(f);
  assert.deepEqual(f.calls, [
    ["context"], ["state", { organisationId: "org-one", subscriptionId: "sub-one" }],
    ["staff", { organisationId: "org-one", organisationMemberId: "member-one" }],
    ["location", { organisationId: "org-one", locationId: "shop-one" }]
  ]);
});

test("access rechecks expiry and the kill switch after asynchronous reads", async () => {
  for (const [target, code] of [["session", "UNAUTHENTICATED"], ["grant", "NOT_ENTITLED"], ["staff", "FORBIDDEN"]]) {
    const f = fixture("MANAGER"); let time = NOW;
    f.dependencies.clock = () => time;
    const expiry = new Date(NOW.getTime() + 1000);
    if (target === "session") f.context.session.expiresAt = expiry;
    if (target === "grant") f.state.grant.expiresAt = expiry;
    if (target === "staff") f.staff[0].expiresAt = expiry;
    f.dependencies.loadLocation = async () => { time = expiry; return f.location; };
    assert.equal((await redeem(f)).code, code);
  }
  const f = fixture();
  f.dependencies.loadLocation = async () => { f.dependencies.env.RUVANAS_RETAIL_REWARDS_ENABLED = "false"; return f.location; };
  assert.equal((await redeem(f)).code, "FEATURE_DISABLED");
});

test("a broad staff grant expiring during a request cannot override a narrower valid grant", async () => {
  const f = fixture("MANAGER"); let time = NOW;
  f.staff.push({ ...f.staff[0], id: "temporary-all", scope: "ALL_LOCATIONS", locationIds: [], expiresAt: new Date(NOW.getTime() + 1) });
  f.dependencies.clock = () => time;
  f.dependencies.loadLocation = async () => { time = new Date(NOW.getTime() + 2); return { ...f.location, id: "shop-other" }; };
  assert.equal((await redeem(f, "shop-other")).code, "LOCATION_UNAVAILABLE");
});

test("missing dependencies, invalid clocks and backend errors are sanitized", async () => {
  for (const key of ["loadContext", "loadRewardsState", "loadStaffGrants", "loadLocation"]) {
    for (const failing of [undefined, async () => { throw new Error("postgres://password@private-host token=secret"); }]) {
      const f = fixture("MANAGER"); f.dependencies[key] = failing;
      const result = await redeem(f);
      assert.equal(result.code, "UNAVAILABLE");
      assert.equal(JSON.stringify(result).includes("secret"), false);
      assert.equal(JSON.stringify(result).includes("password"), false);
    }
  }
  for (const value of [new Date(NaN), NOW.toISOString(), null]) {
    const f = fixture(); f.dependencies.clock = () => value;
    assert.equal((await read(f)).code, "UNAVAILABLE");
  }
  const f = fixture(); let time = NOW;
  f.dependencies.clock = () => time;
  f.dependencies.loadLocation = async () => { time = START; return f.location; };
  assert.equal((await redeem(f)).code, "UNAVAILABLE");
});

test("successful access returns only immutable authority projections and does not mutate inputs", async () => {
  const f = fixture("MANAGER");
  const before = structuredClone({ context: f.context, state: f.state, staff: f.staff, location: f.location });
  const result = await redeem(f);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ["ok", "organisationId", "userId", "organisationMemberId", "action", "locationId", "locationScope", "tier", "limits"].sort());
  for (const object of [result, result.limits, result.locationScope, result.locationScope.locationIds]) assert.equal(Object.isFrozen(object), true);
  assert.throws(() => { result.locationScope.locationIds.push("other"); }, TypeError);
  assert.deepEqual({ context: f.context, state: f.state, staff: f.staff, location: f.location }, before);
});
