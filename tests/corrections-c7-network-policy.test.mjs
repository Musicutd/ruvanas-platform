import test from "node:test";
import assert from "node:assert/strict";
import { correctionsNetworkPermission, normalizeCorrectionsNetworkWindow, correctionsWindowConflict, resolveCorrectionsNetworkWindow, resolveCorrectionsDistributionTargets } from "../lib/corrections-network-policy.mjs";
import { correctionsPolicyEligibility } from "../lib/corrections-policy.mjs";

const scope = { tier: 4, correctionsEnabled: true, organisationId: "authority", memberId: "member" };
const grant = { organisationId: "authority", organisationMemberId: "member", canView: true, canManage: true, canProgramme: true, canDistribute: true, canReport: true };

test("network authority is explicit, tier gated, tenant bound and separate from C6", () => {
  assert.equal(correctionsNetworkPermission({ ...scope, role: "OWNER", capability: "view" }), true);
  assert.equal(correctionsNetworkPermission({ ...scope, tier: 3, role: "OWNER", capability: "view" }), false);
  assert.equal(correctionsNetworkPermission({ ...scope, role: "MANAGER", capability: "view" }), false);
  assert.equal(correctionsNetworkPermission({ ...scope, role: "MANAGER", grant, capability: "manage" }), true);
  assert.equal(correctionsNetworkPermission({ ...scope, role: "VIEWER", grant, capability: "manage" }), false);
  assert.equal(correctionsNetworkPermission({ ...scope, role: "VIEWER", grant, capability: "view" }), true);
  assert.equal(correctionsNetworkPermission({ ...scope, role: "MANAGER", grant: { ...grant, organisationId: "other" }, capability: "view" }), false);
  assert.equal(correctionsNetworkPermission({ ...scope, role: "MANAGER", grant, capability: "emergency" }), false);
});

test("central music restrictions remain effective even when a facility permits more", () => {
  const track = { id: "track-x", artist: "Artist X", isExplicit: false, permittedUses: ["CORRECTIONS_RADIO"], genres: [] };
  const policy = { policyConfiguredAt: new Date(), cleanOnly: true, blockedTrackIds: [], blockedArtists: [], restrictedGenres: [], allowedGenres: [] };
  assert.deepEqual(correctionsPolicyEligibility(track, { baseEligibility: { playable: true }, organisationPolicy: { ...policy, blockedArtists: ["artist x"] }, facilityPolicy: policy }), { playable: false, reason: "CORRECTIONS_ARTIST_BLOCKED" });
  assert.deepEqual(correctionsPolicyEligibility({ ...track, artist: "Artist Y" }, { baseEligibility: { playable: true }, organisationPolicy: policy, facilityPolicy: { ...policy, blockedArtists: ["artist y"] } }), { playable: false, reason: "CORRECTIONS_ARTIST_BLOCKED" });
  assert.deepEqual(correctionsPolicyEligibility(track, { baseEligibility: { playable: true }, organisationPolicy: policy, facilityPolicy: policy }), { playable: true, reason: "CORRECTIONS_POLICY_APPROVED" });
});

test("central mandatory windows win, local windows beat only optional central default", () => {
  const central = { facilityId: "a", kind: "CENTRAL", weekday: 1, startMinute: 0, endMinute: 1440, active: true, mandatory: false };
  const local = { facilityId: "a", kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660, active: true, mandatory: false };
  assert.equal(correctionsWindowConflict(central, local), null);
  assert.equal(resolveCorrectionsNetworkWindow([central, local], { facilityId: "a", weekday: 1, minute: 610 }), local);
  assert.equal(resolveCorrectionsNetworkWindow([central, local], { facilityId: "a", weekday: 1, minute: 665 }), central);
  assert.equal(resolveCorrectionsNetworkWindow([central, local], { facilityId: "b", weekday: 1, minute: 610 }), null);
  assert.equal(correctionsWindowConflict({ ...central, mandatory: true }, local), "MANDATORY_CENTRAL_CONFLICT");
  assert.equal(resolveCorrectionsNetworkWindow([{ ...central, mandatory: true }, local], { facilityId: "a", weekday: 1, minute: 610 }).kind, "CENTRAL");
  assert.equal(normalizeCorrectionsNetworkWindow({ kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660, allowedContentTypes: ["PROGRAMME"] }).kind, "LOCAL");
  assert.throws(() => normalizeCorrectionsNetworkWindow({ kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660, allowedContentTypes: ["PROGRAMME"], mandatory: true }));
});

test("distribution targeting refuses foreign or inactive facility IDs", () => {
  const facilities = [{ id: "a", active: true }, { id: "b", active: true }, { id: "c", active: false }];
  assert.deepEqual(resolveCorrectionsDistributionTargets({ allFacilities: facilities, selectedIds: ["a"], groupMembers: ["b", "a"] }), ["a", "b"]);
  assert.throws(() => resolveCorrectionsDistributionTargets({ allFacilities: facilities, selectedIds: ["c"] }));
  assert.throws(() => resolveCorrectionsDistributionTargets({ allFacilities: facilities, selectedIds: ["foreign"] }));
});

test("three facility plans isolate local windows and resume the central plan", () => {
  const central = ["a", "b", "c"].map((facilityId) => ({ facilityId, kind: "CENTRAL", weekday: 1, startMinute: 0, endMinute: 1440, active: true, mandatory: false }));
  const localA = { facilityId: "a", kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660, active: true };
  const localC = { facilityId: "c", kind: "LOCAL", weekday: 1, startMinute: 780, endMinute: 840, active: true };
  const windows = [...central, localA, localC];
  for (const minute of [599, 660, 900]) assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "a", weekday: 1, minute }).kind, "CENTRAL");
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "a", weekday: 1, minute: 610 }), localA);
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "b", weekday: 1, minute: 610 }).kind, "CENTRAL");
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "c", weekday: 1, minute: 610 }).kind, "CENTRAL");
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "c", weekday: 1, minute: 800 }), localC);
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "foreign", weekday: 1, minute: 610 }), null);
});
