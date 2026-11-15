import test from "node:test";
import assert from "node:assert/strict";
import { staffOverview, staffSaveInput, staffPresets, staffMutationResult, staffGrantState, staffMessage, STAFF_ROLE_CAPABILITIES } from "../lib/retail-rewards/staff-admin-ui.mjs";
import { STAFF_ADMIN_ROLE_CAPABILITIES, staffAdminSchemas } from "../lib/retail-rewards/staff-admin-contracts.mjs";

const now = new Date("2026-11-14T10:00:00.000Z");
function overview(role = "VIEWER") { return {
  ok: true, organisation: { id: "org-a", name: "Sample shops" },
  members: [{ id: "member-a", displayName: "Sample cashier", role, allowedCapabilities: [...STAFF_ROLE_CAPABILITIES[role]], version: "a".repeat(64), grants: [], usesSeat: false }],
  locations: [{ id: "shop-a", name: "Hamrun" }, { id: "shop-b", name: "Valletta" }], seatUsage: { used: 0, limit: 2 },
  grantExpiresAt: "2026-11-30T11:00:00.000Z", checkedAt: now.toISOString()
}; }
const form = () => ({ locationIds: ["shop-a"], capabilities: ["REDEEM"], expiresAt: "2026-11-20T12:00", confirm: true });
const grant = () => ({ id: "grant-a", scope: "LOCATIONS", locationId: "shop-a", capabilities: ["REDEEM"], startsAt: "2026-11-10T00:00:00.000Z", expiresAt: "2026-11-20T00:00:00.000Z", revokedAt: null });

test("Browser role ceilings exactly match the server, with REDEEM-only cashier access", () => {
  assert.deepEqual(STAFF_ROLE_CAPABILITIES, STAFF_ADMIN_ROLE_CAPABILITIES);
  const data = overview(), cashier = staffPresets(data.members[0]).find(row => row.id === "cashier");
  assert.deepEqual(cashier.capabilities, ["REDEEM"]);
  assert.deepEqual(staffPresets(data.members[0]).map(row => row.id), ["cashier"]);
  assert.deepEqual(staffPresets(overview("CONTENT_EDITOR").members[0]).map(row => row.id), ["editor"]);
  assert.equal(staffPresets(overview("MANAGER").members[0]).length, 3);
});
test("Overview accepts exact own-organisation DTO and rejects secret-bearing or foreign responses", () => {
  const data = overview(); assert.equal(staffOverview(data, "org-a"), data); assert.equal(staffOverview(data, "org-b"), null);
  for (const mutate of [
    value => { value.secret = "never-render"; }, value => { value.members[0].email = "private@example.test"; },
    value => { value.organisation.databaseUrl = "private"; }, value => { value.members[0].role = "OWNER"; },
    value => { value.members[0].allowedCapabilities.push("MANAGE_STAFF"); }, value => { value.members[0].version = "stale"; },
    value => { value.locations.push(value.locations[0]); }, value => { value.members.push(value.members[0]); },
    value => { value.members[0].allowedCapabilities.push("READ"); }, value => { value.checkedAt = "2026-11-14"; }
  ]) { const changed = structuredClone(data); mutate(changed); assert.equal(staffOverview(changed), null); }
});
test("Legacy all-shop and inactive-shop grants remain visible without allowing them as new scope", () => {
  const data = overview(); data.members[0].grants = [grant(), { ...grant(), id: "legacy", scope: "ALL_LOCATIONS", locationId: null, capabilities: ["MANAGE_STAFF"] }, { ...grant(), id: "inactive", locationId: "retired-shop", revokedAt: now.toISOString() }];
  assert.equal(staffOverview(data), data);
  data.members[0].grants[0].locationId = null; assert.equal(staffOverview(data), null);
});
test("Save creates a narrow canonical request with current version and no tenant/scope fields", () => {
  const payload = staffSaveInput(overview(), "member-a", form(), now);
  assert.deepEqual(payload, { memberId: "member-a", expectedVersion: "a".repeat(64), locationIds: ["shop-a"], capabilities: ["REDEEM"], expiresAt: "2026-11-20T11:00:00.000Z", confirm: true });
  assert.deepEqual(staffAdminSchemas.save.parse(payload), payload);
  assert.equal(Object.hasOwn(payload, "organisationId"), false); assert.equal(Object.hasOwn(payload, "scope"), false);
});
test("Save requires own active shops and explicit confirmation", () => {
  for (const locationIds of [[], ["foreign-shop"], ["shop-a", "shop-a"], Array.from({length: 21}, (_, i) => `shop-${i}`)])
    assert.throws(() => staffSaveInput(overview(), "member-a", { ...form(), locationIds }, now), /available shops/);
  assert.throws(() => staffSaveInput(overview(), "member-a", { ...form(), confirm: false }, now), /Confirm/);
  assert.throws(() => staffSaveInput(overview(), "foreign-member", form(), now), /current team member/);
});
test("Save never permits role escalation or implicit staff management", () => {
  for (const capabilities of [[], ["REDEEM", "REDEEM"], ["MANAGE_OFFERS"], ["MANAGE_STAFF"], ["EXPORT"]])
    assert.throws(() => staffSaveInput(overview(), "member-a", { ...form(), capabilities }, now), /allowed by this member/);
  assert.throws(() => staffSaveInput(overview("CONTENT_EDITOR"), "member-a", form(), now), /allowed by this member/);
});
test("Expiry is future and bounded by current Rewards access, with exact Malta conversion", () => {
  const data = overview();
  assert.throws(() => staffSaveInput(data, "member-a", { ...form(), expiresAt: "2026-11-14T10:59" }, now), /future expiry/);
  assert.throws(() => staffSaveInput(data, "member-a", { ...form(), expiresAt: "2026-11-30T12:01" }, now), /no later/);
  assert.equal(staffSaveInput(data, "member-a", { ...form(), expiresAt: "2026-11-30T12:00" }, now).expiresAt, data.grantExpiresAt);
  assert.throws(() => staffSaveInput(data, "member-a", { ...form(), expiresAt: "2026-10-25T02:30" }, new Date("2026-10-01T00:00:00.000Z")), /happens twice/i);
});
test("Grant state distinguishes revoked, expired, future and current", () => {
  assert.equal(staffGrantState(grant(), now), "Current");
  assert.equal(staffGrantState({ ...grant(), revokedAt: now.toISOString() }, now), "Revoked");
  assert.equal(staffGrantState({ ...grant(), expiresAt: now.toISOString() }, now), "Expired");
  assert.equal(staffGrantState({ ...grant(), startsAt: "2026-11-15T00:00:00.000Z" }, now), "Starts later");
});
test("Mutation acknowledgement must match the selected member and safe DTO", () => {
  const value = { ok: true, memberId: "member-a", version: "b".repeat(64), changedRows: 2, checkedAt: now.toISOString() };
  assert.equal(staffMutationResult(value, "member-a"), value);
  assert.equal(staffMutationResult(value, "member-b"), null);
  assert.equal(staffMutationResult({ ...value, secret: "not-safe" }, "member-a"), null);
  assert.equal(staffMutationResult({ ...value, changedRows: 1021 }, "member-a"), null);
  assert.equal(staffMutationResult({ ...value, version: "c" }, "member-a"), null);
});
test("Stale and uncertain outcomes require refresh rather than a blind retry", () => {
  assert.match(staffMessage("CONFLICT"), /Refresh, review/);
  assert.match(staffMessage("ORGANISATION_CHANGED"), /Reload this page/);
  assert.match(staffMessage("unexpected-private-error"), /may have completed/);
  assert.doesNotMatch(staffMessage("unexpected-private-error"), /unexpected-private-error/);
});
