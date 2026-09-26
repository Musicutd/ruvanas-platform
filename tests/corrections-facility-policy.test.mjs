import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { correctionsCaps, correctionsFacilityPermission, correctionsMusicEligibility, correctionsPolicyEligibility, normalizeCorrectionsPolicy } from "../lib/corrections-policy.mjs";
import { buildCorrectionsProductOnboarding } from "../lib/product-onboarding.mjs";

const readyPolicy = { policyConfiguredAt: new Date(), cleanOnly: true, allowedGenres: [], restrictedGenres: [], blockedArtists: [], blockedTrackIds: [] };
const track = { id: "track-1", artist: "Example Artist", isExplicit: false, permittedUses: ["CORRECTIONS_RADIO"], mediaAsset: { genres: [{ mediaGenre: { name: "Pop" } }] } };
const check = (candidate, organisationPolicy = readyPolicy, facilityPolicy = readyPolicy, youthFacility = false, baseEligibility = { playable: true }) => correctionsPolicyEligibility(candidate, { baseEligibility, organisationPolicy, facilityPolicy, youthFacility });

test("Corrections caps are default-denied and tier-bounded", () => {
  assert.deepEqual(correctionsCaps({ planTierNumber: 5 }), { facilities: 0, zones: 0 });
  assert.deepEqual(correctionsCaps({ correctionsRadioEnabled: true, planTierNumber: 1 }), { facilities: 1, zones: 2 });
  assert.deepEqual(correctionsCaps({ correctionsRadioEnabled: true, planTierNumber: 4 }), { facilities: 5, zones: 50 });
  assert.deepEqual(correctionsCaps({ correctionsRadioEnabled: true, planTierNumber: 99 }), { facilities: 0, zones: 0 });
});

test("facility access requires tenant, member, location and edit permission to match", () => {
  const assignment = { organisationId: "org-a", organisationMemberId: "member-a", facilityId: "loc-a", permission: "MANAGER" };
  const context = { role: "MANAGER", organisationId: "org-a", memberId: "member-a", locationId: "loc-a", assignment, edit: true };
  assert.equal(correctionsFacilityPermission(context), true);
  assert.equal(correctionsFacilityPermission({ ...context, organisationId: "org-b" }), false);
  assert.equal(correctionsFacilityPermission({ ...context, memberId: "member-b" }), false);
  assert.equal(correctionsFacilityPermission({ ...context, locationId: "loc-b" }), false);
  assert.equal(correctionsFacilityPermission({ ...context, role: "VIEWER" }), false);
  assert.equal(correctionsFacilityPermission({ ...context, assignment: { ...assignment, permission: "VIEWER" } }), false);
  assert.equal(correctionsFacilityPermission({ ...context, role: "VIEWER", edit: false }), true);
  assert.equal(correctionsFacilityPermission({ ...context, role: "OWNER", assignment: null }), true);
});

test("Corrections policy input normalises lists and cannot permit explicit music", () => {
  assert.deepEqual(normalizeCorrectionsPolicy({ allowedGenres: ["Pop", "pop"], blockedArtists: [" Example Artist "] }).allowedGenres, ["POP"]);
  assert.deepEqual(normalizeCorrectionsPolicy({ blockedArtists: [" Example Artist "] }).blockedArtists, ["example artist"]);
  assert.throws(() => normalizeCorrectionsPolicy({ cleanOnly: false }), /Explicit music/);
  assert.throws(() => normalizeCorrectionsPolicy({ blockedTrackIds: [3] }), /short text/);
});

test("rights, policy, content and youth restrictions can only narrow eligibility", () => {
  assert.equal(check(track).playable, true);
  assert.equal(check(track, readyPolicy, readyPolicy, false, { playable: false, reason: "RIGHTS_NOT_APPROVED" }).reason, "RIGHTS_NOT_APPROVED");
  assert.equal(check(track, null).reason, "CORRECTIONS_POLICY_NOT_CONFIGURED");
  assert.equal(check({ ...track, isExplicit: true }).reason, "CORRECTIONS_CONTENT_RESTRICTED");
  assert.equal(check({ ...track, isExplicit: undefined }).playable, false);
  assert.equal(check({ ...track, permittedUses: ["RETAIL_RADIO"] }).reason, "CORRECTIONS_USE_NOT_PERMITTED");
  assert.equal(check({ ...track, contentWarning: "Violence" }, readyPolicy, readyPolicy, true).playable, false);
  assert.equal(check(track, { ...readyPolicy, blockedArtists: ["example artist"] }).reason, "CORRECTIONS_ARTIST_BLOCKED");
  assert.equal(check(track, readyPolicy, { ...readyPolicy, blockedTrackIds: ["track-1"] }).reason, "CORRECTIONS_TRACK_BLOCKED");
  assert.equal(check(track, { ...readyPolicy, restrictedGenres: ["POP"] }).reason, "CORRECTIONS_GENRE_RESTRICTED");
  assert.equal(check(track, { ...readyPolicy, allowedGenres: ["CLASSICAL"] }).reason, "CORRECTIONS_GENRE_NOT_ALLOWED");
});

test("rights wrapper derives territory from the owned facility rather than caller input", () => {
  const facility = { locationId: "loc-a", youthFacility: false, location: { organisationId: "org-a", countryCode: "MT" } };
  assert.equal(correctionsMusicEligibility(track, { organisationId: "org-b", facility, facilityPolicy: { ...readyPolicy, locationId: "loc-a" }, organisationPolicy: readyPolicy, territory: "US" }).reason, "CORRECTIONS_FACILITY_OR_TERRITORY_REQUIRED");
  assert.equal(correctionsMusicEligibility(track, { organisationId: "org-a", facility, facilityPolicy: { ...readyPolicy, locationId: "loc-b" }, organisationPolicy: readyPolicy }).playable, false);
});

test("onboarding uses actual facility and policy evidence but never claims playback ready", () => {
  const incomplete = buildCorrectionsProductOnboarding({ serviceEnabled: true });
  assert.equal(incomplete.nextStepId, "FACILITY_POLICY");
  const prepared = buildCorrectionsProductOnboarding({ serviceEnabled: true, facilityCount: 1, zoneCount: 1, organisationPolicyReady: true, facilityPolicyReadyCount: 1 });
  assert.equal(prepared.nextStepId, "PRIVATE_DELIVERY");
  assert.equal(prepared.complete, false);
});

test("C2 uses Location/Zone, tenant-scoped APIs and no Corrections playback route", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/corrections/facilities/route.js", import.meta.url), "utf8");
  const facilityApi = await readFile(new URL("../app/api/corrections/facilities/[facilityId]/route.js", import.meta.url), "utf8");
  const access = await readFile(new URL("../lib/corrections-access.js", import.meta.url), "utf8");
  assert.match(schema, /model CorrectionsProfile/);
  assert.match(schema, /model CorrectionsFacility/);
  assert.match(api, /tx\.location\.create/);
  assert.match(api, /status: "DRAFT"/);
  assert.match(api, /status: "OFFLINE"/);
  assert.match(access, /organisationId: access\.organisationId/);
  assert.match(facilityApi, /correctionsFacilityAccess\(access, params\.facilityId, \{ edit: true \}\)/);
});
