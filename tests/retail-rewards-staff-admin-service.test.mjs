import test from "node:test";
import assert from "node:assert/strict";
import { createRewardStaffAdminService } from "../lib/retail-rewards/staff-admin-service.mjs";
import { readStaffAdminPolicy, staffAdminSchemas } from "../lib/retail-rewards/staff-admin-contracts.mjs";
const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2026-11-30T12:00:00.000Z"), START = new Date("2026-11-01T00:00:00.000Z");
const ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_STAFF_ADMIN_ENABLED: "true" };
const clone = value => structuredClone(value);
function matches(row, where = {}) { return Object.entries(where).every(([key, value]) => {
  const actual = row?.[key];
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (Object.hasOwn(value, "in")) return value.in.includes(actual);
    if (Object.hasOwn(value, "gt")) return actual > value.gt;
    return matches(actual, value);
  }
  return value instanceof Date ? +actual === +value : actual === value;
}); }
function project(row, select) {
  if (!row) return null; if (!select) return clone(row);
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key, value === true ? clone(row[key]) : project(row[key], value.select)]));
}
function fixture() {
  let state = { session: { id: "session", userId: "owner", activeOrganisationId: "org", expiresAt: END, revokedAt: null, authMethod: "PASSWORD" },
    user: ["owner", "cashier", "editor", "manager", "second"].map((id, i) => ({ id, name: `Person ${i}`, role: i === 0 ? "OWNER" : "VIEWER", privatePreviewAccess: null })),
    organisationMember: ["owner", "cashier", "editor", "manager", "second"].map((userId, i) => ({ id: `member-${userId}`, userId, organisationId: "org", role: ["OWNER", "VIEWER", "CONTENT_EDITOR", "MANAGER", "VIEWER"][i] })),
    organisation: [{ id: "org", name: "Synthetic merchant" }],
    subscription: { id: "subscription", organisationId: "org", status: "ACTIVE", plan: { id: "plan", active: true, code: "RETAIL_START", productFamily: "RETAIL", retailRadioEnabled: true } },
    rewardProgram: [{ id: "program", organisationId: "org", status: "ACTIVE" }],
    rewardEntitlementGrant: [{ id: "grant", organisationId: "org", subscriptionId: "subscription", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "TRIAL",
      startsAt: START, expiresAt: END, revokedAt: null, limitsVersion: 1, activeOffers: 5, locations: 2, staffSeats: 2, monthlyRedemptions: 20, analyticsRetentionDays: 30, exportEnabled: true, brandingEnabled: false }],
    location: [{ id: "shop-one", organisationId: "org", name: "First shop", status: "ACTIVE" }, { id: "shop-two", organisationId: "org", name: "Second shop", status: "ACTIVE" },
      { id: "foreign-shop", organisationId: "foreign", name: "Private foreign shop", status: "ACTIVE" }], rewardStaffGrant: [], rewardAuditEvent: [] };
  const env = { ...ENV }, calls = []; let current = NOW, beforeTransaction, afterWrite, failAudit = false, serial = 0;
  function client(data) {
    const db = { _data: data };
    const hydrated = (model, row) => row && (model === "organisationMember" ? { ...row, user: data.user.find(user => user.id === row.userId) } : row);
    for (const model of Object.keys(data).filter(key => Array.isArray(data[key]))) db[model] = {
      async findUnique({ where, select }) { return project(hydrated(model, data[model].find(row => matches(row, where))), select); },
      async findFirst({ where, select }) { return project(hydrated(model, data[model].find(row => matches(row, where))), select); },
      async findMany({ where, select, take } = {}) { return data[model].filter(row => matches(row, where)).slice(0, take).map(row => project(hydrated(model, row), select)); },
      async create({ data: values, select }) { if (model === "rewardAuditEvent" && failAudit) throw new Error("Synthetic failure with no public error detail");
        const row = { id: `row-${++serial}`, ...clone(values) }; data[model].push(row); calls.push({ model, operation: "create" }); afterWrite?.(data, model); return project(row, select); },
      async update({ where, data: values, select }) { const row = data[model].find(row => matches(row, where)); if (!row) throw new Error("missing");
        Object.assign(row, clone(values)); calls.push({ model, operation: "update" }); afterWrite?.(data, model); return project(row, select); }
    };
    db.$queryRaw = async (parts, ...values) => {
      const sql = parts.join("?"); calls.push({ sql });
      if (sql.includes('FROM "RewardProgram"')) return data.rewardProgram.filter(row => row.organisationId === values[0]).map(row => ({ id: row.id }));
      if (sql.includes('FROM "Session"')) return [{ id: data.session.id }];
      if (sql.includes('FROM "OrganisationMember"')) return data.organisationMember.filter(row => row.organisationId === values[0]).slice(0, 101).map(row => ({ id: row.id }));
      if (sql.includes('FROM "RewardStaffGrant"')) return data.rewardStaffGrant.filter(row => row.organisationId === values[0] && row.organisationMemberId === values[1]).slice(0, 1001).map(row => ({ id: row.id }));
      if (sql.includes('FROM "Location"')) return data.location.filter(row => row.organisationId === values[0] && JSON.parse(values[1]).includes(row.id)).map(row => ({ id: row.id }));
      return [];
    };
    return db;
  }
  const db = new Proxy({}, { get(_target, key) {
    if (key === "$transaction") return async (run, options) => { assert.equal(options.isolationLevel, "Serializable"); beforeTransaction?.(state);
      const working = clone(state); const result = await run(client(working)); state = working; return result; };
    return client(state)[key];
  } });
  const loadContext = async client => { const data = client._data, membership = data.organisationMember.find(row => row.id === "member-owner");
    return clone({ session: data.session, user: data.user.find(row => row.id === "owner"), memberships: data.organisationMember.filter(row => row.userId === "owner"),
      membership: membership && { ...membership, organisation: { ...data.organisation[0], subscription: data.subscription } } }); };
  const service = createRewardStaffAdminService({ db, env, loadContext, clock: () => new Date(current) });
  return { service, env, calls, get data() { return state; }, set beforeTransaction(value) { beforeTransaction = value; },
    set afterWrite(value) { afterWrite = value; }, set failAudit(value) { failAudit = value; }, set now(value) { current = value; },
    grant(member = "cashier", values = {}) { const row = { id: `existing-${++serial}`, organisationId: "org", organisationMemberId: `member-${member}`, scope: "LOCATIONS", locationId: "shop-one", capabilities: ["REDEEM"], startsAt: START, expiresAt: END, revokedAt: null, ...values }; state.rewardStaffGrant.push(row); return row; } };
}
async function request(f, memberId = "member-cashier", values = {}) {
  const overview = await f.service.overview({}); assert.equal(overview.ok, true, JSON.stringify(overview));
  const member = overview.members.find(row => row.id === memberId); assert.ok(member);
  return { memberId, expectedVersion: member.version, locationIds: ["shop-one"], capabilities: ["REDEEM"], expiresAt: END.toISOString(), confirm: true, ...values };
}

test("strict independent flags fail closed without loading anything", async () => {
  for (const value of [undefined, true, "TRUE", " true", "false", "1"]) assert.equal(readStaffAdminPolicy({ ...ENV, RUVANAS_RETAIL_REWARDS_STAFF_ADMIN_ENABLED: value }).enabled, false);
  const f = fixture(); delete f.env.RUVANAS_RETAIL_REWARDS_ENABLED;
  assert.equal((await f.service.overview({})).code, "FEATURE_DISABLED"); assert.equal(f.calls.length, 0);
});
test("request schemas reject authority injection, duplicate scopes and MANAGE_STAFF; REDEEM needs no READ", () => {
  const value = { memberId: "member", expectedVersion: "a".repeat(64), confirm: true, locationIds: ["shop"], capabilities: ["REDEEM"], expiresAt: END.toISOString() };
  assert.equal(staffAdminSchemas.save.safeParse(value).success, true);
  for (const change of [{ organisationId: "foreign" }, { capabilities: ["MANAGE_STAFF"] }, { locationIds: ["shop", "shop"] }, { capabilities: ["REDEEM", "REDEEM"] }, { scope: "ALL_LOCATIONS" }, { startsAt: START.toISOString() }])
    assert.equal(staffAdminSchemas.save.safeParse({ ...value, ...change }).success, false);
});
test("owner-only normal session cannot use preview or platform/student bypass", async () => {
  for (const scenario of ["manager", "preview", "support", "super", "student", "revoked"]) {
    const f = fixture();
    if (scenario === "manager") f.data.organisationMember[0].role = "MANAGER";
    if (scenario === "preview") f.data.user[0].privatePreviewAccess = { userId: "owner" };
    if (scenario === "support") f.data.user[0].role = "SUPPORT";
    if (scenario === "super") f.data.user[0].role = "SUPER_ADMIN";
    if (scenario === "student") f.data.user[0].role = "STUDENT";
    if (scenario === "revoked") f.data.session.revokedAt = NOW;
    assert.equal((await f.service.overview({})).ok, false, scenario); assert.equal(f.data.rewardAuditEvent.length, 0);
  }
});
test("overview projects own eligible members without email or identities from other organisations", async () => {
  const f = fixture(); f.data.user[2].email = "private@example.test"; f.data.user[2].privatePreviewAccess = { userId: "editor" };
  f.data.user[3].role = "STUDENT";
  const result = await f.service.overview({}); assert.equal(result.ok, true);
  assert.deepEqual(result.members.map(row => row.id), ["member-cashier", "member-second"]);
  assert.equal(JSON.stringify(result).includes("email"), false); assert.equal(result.locations.length, 2); assert.equal(result.seatUsage.used, 0);
});
test("save REDEEM-only grant and record exact immutable safe snapshot", async () => {
  const f = fixture(), result = await f.service.save(await request(f)); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.changedRows, 1); assert.deepEqual(f.data.rewardStaffGrant[0].capabilities, ["REDEEM"]);
  const audit = f.data.rewardAuditEvent[0]; assert.equal(audit.action, "STAFF_GRANT_CREATED"); assert.deepEqual(audit.metadata.after.capabilities, ["REDEEM"]);
  assert.equal(audit.metadata.after.organisationMemberId, "member-cashier"); assert.equal(audit.metadata.after.startsAt, NOW.toISOString());
  assert.equal((await f.service.overview({})).seatUsage.used, 1);
});
test("stale rowset token rejects saves and revokes without audit", async () => {
  const f = fixture(), first = await request(f); assert.equal((await f.service.save(first)).ok, true);
  assert.equal((await f.service.save(first)).code, "CONFLICT");
  assert.equal((await f.service.revoke({ memberId: first.memberId, expectedVersion: first.expectedVersion, confirm: true })).code, "CONFLICT");
  assert.equal(f.data.rewardAuditEvent.length, 1);
});
test("scope replacement revokes ALL_LOCATIONS, future and omitted shops; records before and after", async () => {
  const f = fixture(); f.grant("cashier", { scope: "ALL_LOCATIONS", locationId: null, capabilities: ["READ", "REDEEM"] });
  f.grant("cashier", { locationId: "shop-two", startsAt: new Date("2026-11-20T00:00:00.000Z") });
  const result = await f.service.save(await request(f)); assert.equal(result.ok, true); assert.equal(result.changedRows, 3);
  assert.equal(f.data.rewardStaffGrant.filter(row => row.revokedAt === null).length, 1);
  const revoked = f.data.rewardAuditEvent.filter(row => row.action === "STAFF_GRANT_REVOKED"); assert.equal(revoked.length, 2);
  assert.equal(revoked[0].metadata.before.revokedAt, null); assert.equal(revoked[0].metadata.after.revokedAt, NOW.toISOString());
});
test("replacing existing scope reuses row and revocation retains history", async () => {
  const f = fixture(); f.grant(); const before = f.data.rewardStaffGrant[0].id;
  assert.equal((await f.service.save(await request(f, "member-cashier", { capabilities: ["READ"] }))).ok, true);
  assert.equal(f.data.rewardStaffGrant[0].id, before); assert.equal(f.data.rewardAuditEvent[0].action, "STAFF_GRANT_CHANGED");
  assert.deepEqual(f.data.rewardAuditEvent[0].metadata.before.capabilities, ["REDEEM"]);
  const { memberId, expectedVersion } = await request(f); assert.equal((await f.service.revoke({ memberId, expectedVersion, confirm: true })).ok, true);
  assert.equal(f.data.rewardStaffGrant.length, 1); assert.ok(f.data.rewardStaffGrant[0].revokedAt);
  assert.equal((await f.service.overview({})).seatUsage.used, 0);
});
test("seat accounting counts future reservations once per member", async () => {
  const f = fixture(); f.data.rewardEntitlementGrant[0].staffSeats = 1;
  f.grant("second", { startsAt: new Date("2026-11-20T00:00:00.000Z") });
  f.grant("second", { locationId: "shop-two", startsAt: new Date("2026-11-20T00:00:00.000Z") });
  assert.equal((await f.service.overview({})).seatUsage.used, 1);
  assert.equal((await f.service.save(await request(f))).code, "LIMIT_REACHED"); assert.equal(f.data.rewardAuditEvent.length, 0);
  assert.equal((await f.service.save(await request(f, "member-second"))).ok, true);
});
test("role changes and ineligible users cannot free reservations that may reactivate", async () => {
  for (const mode of ["demotion", "platform", "preview"]) {
    const f = fixture(); f.data.rewardEntitlementGrant[0].staffSeats = 1;
    f.grant("manager", { capabilities: ["REVERSE"] });
    if (mode === "demotion") f.data.organisationMember[3].role = "VIEWER";
    if (mode === "platform") f.data.user[3].role = "SUPPORT";
    if (mode === "preview") f.data.user[3].privatePreviewAccess = { userId: "manager" };
    assert.equal((await f.service.overview({})).seatUsage.used, 1);
    assert.equal((await f.service.save(await request(f))).code, "LIMIT_REACHED", mode);
  }
});
test("role ceilings, foreign/owner targets and inactive/foreign shops fail closed", async () => {
  for (const [member, values, expected] of [["member-cashier", { capabilities: ["REVERSE"] }, "FORBIDDEN"], ["member-editor", { capabilities: ["REDEEM"] }, "FORBIDDEN"],
    ["member-cashier", { locationIds: ["foreign-shop"] }, "LOCATION_UNAVAILABLE"], ["member-cashier", { locationIds: ["absent"] }, "LOCATION_UNAVAILABLE"]]) {
    const f = fixture(); assert.equal((await f.service.save(await request(f, member, values))).code, expected); assert.equal(f.data.rewardStaffGrant.length, 0);
  }
  const f = fixture(), input = await request(f);
  for (const memberId of ["member-owner", "foreign-member", "absent"]) assert.equal((await f.service.save({ ...input, memberId })).code, "FORBIDDEN");
  f.data.location[0].status = "INACTIVE"; assert.equal((await f.service.save(input)).code, "LOCATION_UNAVAILABLE");
});
test("expiry and location allowance cannot be extended", async () => {
  const f = fixture(); f.data.rewardEntitlementGrant[0].locations = 1;
  assert.equal((await f.service.save(await request(f, "member-cashier", { locationIds: ["shop-one", "shop-two"] }))).code, "LIMIT_REACHED");
  for (const expiresAt of [NOW.toISOString(), "2027-01-01T00:00:00.000Z"]) assert.equal((await f.service.save(await request(f, "member-cashier", { expiresAt }))).code, "INVALID_REQUEST");
});
test("target role is part of optimistic version and is freshly rechecked inside transaction", async () => {
  const f = fixture(), input = await request(f); f.beforeTransaction = data => { data.organisationMember[1].role = "MANAGER"; };
  assert.equal((await f.service.save(input)).code, "CONFLICT"); assert.equal(f.data.rewardStaffGrant.length, 0);
});
test("entitlement/session revocation and expiration during write roll back grant and audit", async () => {
  for (const mode of ["grant", "session", "role", "expiry", "gate"]) {
    const f = fixture(), input = await request(f); f.afterWrite = (data, model) => { if (model !== "rewardStaffGrant") return;
      if (mode === "grant") data.rewardEntitlementGrant[0].revokedAt = NOW;
      if (mode === "session") data.session.revokedAt = NOW;
      if (mode === "role") data.organisationMember[0].role = "MANAGER";
      if (mode === "expiry") f.now = END;
      if (mode === "gate") f.env.RUVANAS_RETAIL_REWARDS_STAFF_ADMIN_ENABLED = "false";
    };
    assert.equal((await f.service.save(input)).ok, false, mode); assert.equal(f.data.rewardStaffGrant.length, 0); assert.equal(f.data.rewardAuditEvent.length, 0);
  }
});
test("audit failure rolls back all changed grants", async () => {
  const f = fixture(); f.grant("cashier", { locationId: "shop-two" }); const input = await request(f); f.failAudit = true;
  assert.equal((await f.service.save(input)).code, "UNAVAILABLE"); assert.equal(f.data.rewardStaffGrant.length, 1); assert.equal(f.data.rewardStaffGrant[0].revokedAt, null);
});
test("bounded authority reads fail rather than truncate", async () => {
  const f = fixture(); for (let i = 0; i < 1001; i++) f.grant("cashier", { id: `grant-${i}` });
  assert.equal((await f.service.overview({})).code, "REVIEW_TOO_LARGE");
});
test("locks follow programme, actor authority, membership and grant order", async () => {
  const f = fixture(); await f.service.overview({}); const sql = f.calls.filter(row => row.sql).map(row => row.sql);
  assert.match(sql[0], /RewardProgram.*FOR UPDATE/); assert.match(sql[1], /FOR SHARE OF s, u, m, sub, p, g/);
  assert.ok(sql.find(row => /OrganisationMember.*JOIN "User"/s.test(row))); assert.ok(sql.find(row => /RewardStaffGrant.*FOR UPDATE/s.test(row)));
});
