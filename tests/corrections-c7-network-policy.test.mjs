import test from "node:test";
import assert from "node:assert/strict";
import { correctionsNetworkPermission, normalizeCorrectionsNetworkWindow, correctionsWindowConflict, resolveCorrectionsNetworkWindow, rankCorrectionsNetworkWindows, resolveCorrectionsDistributionTargets } from "../lib/corrections-network-policy.mjs";
import { correctionsPolicyEligibility } from "../lib/corrections-policy.mjs";
import { correctionsNetworkSourcePolicy } from "../lib/corrections-network-source-policy.mjs";
import { normaliseCorrectionsNetworkReportFilters, correctionsNetworkReportCsv } from "../lib/corrections-network-report.mjs";

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
  const central = { facilityId: "a", kind: "CENTRAL", distributionId: "central-version", weekday: 1, startMinute: 0, endMinute: 1440, active: true, mandatory: false };
  const local = { facilityId: "a", kind: "LOCAL", distributionId: "local-version", weekday: 1, startMinute: 600, endMinute: 660, active: true, mandatory: false };
  assert.equal(correctionsWindowConflict(central, local), null);
  assert.equal(resolveCorrectionsNetworkWindow([central, local], { facilityId: "a", weekday: 1, minute: 610 }), local);
  assert.equal(resolveCorrectionsNetworkWindow([central, local], { facilityId: "a", weekday: 1, minute: 665 }), central);
  assert.equal(resolveCorrectionsNetworkWindow([central, local], { facilityId: "b", weekday: 1, minute: 610 }), null);
  assert.equal(correctionsWindowConflict({ ...central, mandatory: true }, local), "MANDATORY_CENTRAL_CONFLICT");
  const mandatoryAnnouncement = { ...central, id: "announcement-window", distributionId: null,
    audioDistributionId: "announcement-version", mandatory: true };
  assert.equal(correctionsWindowConflict(central, mandatoryAnnouncement), null);
  assert.deepEqual(rankCorrectionsNetworkWindows([central, mandatoryAnnouncement], { facilityId: "a", weekday: 1, minute: 610 }),
    [mandatoryAnnouncement, central], "the valid central default remains a fallback after mandatory audio");
  assert.equal(resolveCorrectionsNetworkWindow([{ ...central, mandatory: true }, local], { facilityId: "a", weekday: 1, minute: 610 }).kind, "CENTRAL");
  assert.deepEqual(rankCorrectionsNetworkWindows([central, local], { facilityId: "a", weekday: 1, minute: 610 }), [local, central]);
  assert.deepEqual(rankCorrectionsNetworkWindows([{ ...local, distributionId: null }, central], { facilityId: "a", weekday: 1, minute: 610 }), [central]);
  assert.equal(normalizeCorrectionsNetworkWindow({ kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660, distributionId: "approved-local-version", allowedContentTypes: ["PROGRAMME"] }).distributionId, "approved-local-version");
  assert.throws(() => normalizeCorrectionsNetworkWindow({ kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660, allowedContentTypes: ["PROGRAMME"] }));
  assert.throws(() => normalizeCorrectionsNetworkWindow({ kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660, distributionId: "approved-local-version", allowedContentTypes: ["PROGRAMME"], mandatory: true }));
});

test("distribution targeting refuses foreign or inactive facility IDs", () => {
  const facilities = [{ id: "a", active: true }, { id: "b", active: true }, { id: "c", active: false }];
  assert.deepEqual(resolveCorrectionsDistributionTargets({ allFacilities: facilities, selectedIds: ["a"], groupMembers: ["b", "a"] }), ["a", "b"]);
  assert.throws(() => resolveCorrectionsDistributionTargets({ allFacilities: facilities, selectedIds: ["c"] }));
  assert.throws(() => resolveCorrectionsDistributionTargets({ allFacilities: facilities, selectedIds: ["foreign"] }));
  assert.deepEqual(resolveCorrectionsDistributionTargets({ allFacilities: facilities, includeAll: true }), ["a", "b"]);
  assert.throws(() => resolveCorrectionsDistributionTargets({ allFacilities: facilities, includeAll: true, selectedIds: ["a"] }));
});

test("network audio intersects central and target facility restrictions", () => {
  const media = { id: "source-x", status: "READY", libraryType: "ORGANISATION_PROMO", mediaType: "ANNOUNCEMENT",
    genres: [{ mediaGenre: { slug: "spoken-word" } }] };
  const policy = { policyConfiguredAt: new Date(), blockedTrackIds: [], restrictedGenres: [], allowedGenres: [] };
  const check = (central, facility, sourceMedia = [media]) => correctionsNetworkSourcePolicy({ sourceMedia,
    outputMediaAssetId: "output-x", organisationPolicy: central, facilityPolicy: facility });
  assert.equal(check(policy, policy).allowed, true);
  assert.equal(check({ ...policy, blockedTrackIds: ["SOURCE-X"] }, policy).reason, "CORRECTIONS_SOURCE_BLOCKED");
  assert.equal(check(policy, { ...policy, blockedTrackIds: ["output-x"] }).reason, "CORRECTIONS_SOURCE_BLOCKED");
  assert.equal(check(policy, { ...policy, restrictedGenres: ["SPOKEN_WORD"] }).reason, "CORRECTIONS_GENRE_RESTRICTED");
  assert.equal(check(policy, { ...policy, allowedGenres: ["other"] }).reason, "CORRECTIONS_GENRE_NOT_ALLOWED");
  assert.equal(check(policy, { ...policy, allowedGenres: ["SPOKEN_WORD"] }).allowed, true);
  assert.equal(check(policy, { ...policy, policyConfiguredAt: null }).allowed, false);
  assert.equal(check(policy, policy, [{ ...media, mediaType: "MUSIC" }]).reason, "NETWORK_MUSIC_RIGHTS_UNVERIFIED");
});

test("three facility plans isolate local windows and resume the central plan", () => {
  const central = ["a", "b", "c"].map((facilityId) => ({ facilityId, kind: "CENTRAL", distributionId: `central-${facilityId}`, weekday: 1, startMinute: 0, endMinute: 1440, active: true, mandatory: false }));
  const localA = { facilityId: "a", kind: "LOCAL", distributionId: "local-a", weekday: 1, startMinute: 600, endMinute: 660, active: true };
  const localC = { facilityId: "c", kind: "LOCAL", distributionId: "local-c", weekday: 1, startMinute: 780, endMinute: 840, active: true };
  const windows = [...central, localA, localC];
  for (const minute of [599, 660, 900]) assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "a", weekday: 1, minute }).kind, "CENTRAL");
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "a", weekday: 1, minute: 610 }), localA);
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "b", weekday: 1, minute: 610 }).kind, "CENTRAL");
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "c", weekday: 1, minute: 610 }).kind, "CENTRAL");
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "c", weekday: 1, minute: 800 }), localC);
  assert.equal(resolveCorrectionsNetworkWindow(windows, { facilityId: "foreign", weekday: 1, minute: 610 }), null);
});

test("network export filters are bounded and CSV cannot inject formulas or private details", () => {
  const filters = normaliseCorrectionsNetworkReportFilters({ from: "2026-09-01", to: "2026-09-07", groupId: "north", source: "CORRECTIONS_LOCAL", status: "COMPLETED" });
  assert.equal(filters.groupId, "north");
  assert.equal(filters.until.toISOString(), "2026-09-08T00:00:00.000Z");
  assert.throws(() => normaliseCorrectionsNetworkReportFilters({ from: "2026-01-01", to: "2026-09-01" }));
  assert.throws(() => normaliseCorrectionsNetworkReportFilters({ facilityId: "a", groupId: "north" }));
  assert.throws(() => normaliseCorrectionsNetworkReportFilters({ source: "ONLINE_RADIO" }));
  assert.deepEqual(normaliseCorrectionsNetworkReportFilters({ kind: "PROGRAMME", classification: "LOCAL" }).allowedSources, ["CORRECTIONS_LOCAL"]);
  assert.throws(() => normaliseCorrectionsNetworkReportFilters({ kind: "PROGRAMME", source: "CORRECTIONS_STANDARD" }));
  assert.throws(() => normaliseCorrectionsNetworkReportFilters({ kind: "REQUEST", programmeId: "programme-a" }));
  assert.throws(() => normaliseCorrectionsNetworkReportFilters({ rehabilitationId: "bad,name" }));
  const csv = correctionsNetworkReportCsv([{ occurredAt: "2026-09-07T10:00:00.000Z", facility: "=private", facilityId: "a",
    classification: "LOCAL", kind: "PROGRAMME", source: "CORRECTIONS_LOCAL", status: "COMPLETED",
    proofEventId: "proof-a", playoutIntentId: "intent-a", sourceRevision: "c7:version-a",
    programmeId: "programme-a", submissionId: "submission-a" }]);
  assert.match(csv, /'=private/);
  assert.match(csv, /proof-a,intent-a,c7:version-a,programme-a,submission-a/);
  assert.doesNotMatch(csv, /contributor|family|requestBody/i);
});
