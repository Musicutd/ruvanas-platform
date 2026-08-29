import assert from "node:assert/strict";
import test from "node:test";
import {
  importedExchangeIsPlayable,
  normaliseSchoolExchangeIntendedUse,
  redactedSchoolExchangeOffer,
  transitionSchoolExchangeOffer,
  transitionSchoolExchangeRequest,
  validateSchoolEpisodeExchangeEligibility
} from "../lib/school-network-exchange.mjs";

const instant = new Date("2026-09-15T09:00:00.000Z");

test("cross-school offers require approved audio, staff confirmation, and consent for every contributor", () => {
  const input = {
    episodeStatus: "APPROVED",
    promoVersionStatus: "APPROVED",
    promoAssetStatus: "ACTIVE",
    contributorIds: ["student-a", "student-b"],
    consentRecords: [
      { contributorId: "student-a", status: "GRANTED", expiresAt: null, revokedAt: null },
      { contributorId: "student-b", status: "GRANTED", expiresAt: "2026-09-16T00:00:00.000Z", revokedAt: null }
    ],
    consentConfirmed: true,
    instant
  };
  assert.equal(validateSchoolEpisodeExchangeEligibility(input).policyVersion, "school-network-exchange-v1");
  assert.throws(() => validateSchoolEpisodeExchangeEligibility({ ...input, episodeStatus: "IN_REVIEW" }), /staff-approved/);
  assert.throws(() => validateSchoolEpisodeExchangeEligibility({ ...input, consentConfirmed: false }), /confirm/);
  assert.throws(() => validateSchoolEpisodeExchangeEligibility({ ...input, consentRecords: input.consentRecords.slice(0, 1) }), /Every student contributor/);
  assert.throws(() => validateSchoolEpisodeExchangeEligibility({ ...input, consentRecords: [{ ...input.consentRecords[0], expiresAt: "2026-09-14T00:00:00.000Z" }, input.consentRecords[1]] }), /Every student contributor/);
});

test("staff-only episodes can be offered without inventing student consent records", () => {
  assert.equal(validateSchoolEpisodeExchangeEligibility({ episodeStatus: "APPROVED", promoVersionStatus: "APPROVED", promoAssetStatus: "ACTIVE", contributorIds: [], consentRecords: [], consentConfirmed: true }).consentConfirmed, true);
});

test("offer and request transitions are bounded and revocation needs a reason", () => {
  assert.equal(transitionSchoolExchangeOffer({ currentStatus: "AVAILABLE", action: "PAUSE" }).status, "PAUSED");
  assert.equal(transitionSchoolExchangeOffer({ currentStatus: "PAUSED", action: "RESUME" }).status, "AVAILABLE");
  assert.throws(() => transitionSchoolExchangeOffer({ currentStatus: "AVAILABLE", action: "WITHDRAW" }), /reason/);
  assert.equal(transitionSchoolExchangeRequest({ currentStatus: "PENDING", action: "APPROVE" }).status, "APPROVED");
  assert.throws(() => transitionSchoolExchangeRequest({ currentStatus: "APPROVED", action: "REVOKE" }), /reason/);
  assert.equal(transitionSchoolExchangeRequest({ currentStatus: "APPROVED", action: "REVOKE", notes: "Consent was withdrawn." }).status, "REVOKED");
  assert.throws(() => transitionSchoolExchangeRequest({ currentStatus: "DECLINED", action: "APPROVE" }), /cannot use/);
});

test("network-library responses never expose episodes, audio identifiers, users, or student records", () => {
  const redacted = redactedSchoolExchangeOffer({
    id: "offer-1",
    sourceOrganisationId: "school-a",
    sourceOrganisation: { id: "school-a", name: "School A" },
    sourceTitle: "Science bulletin",
    sourceSummary: "A supervised science programme.",
    languageCode: "en",
    durationSeconds: 600,
    status: "AVAILABLE",
    availableAt: instant,
    policyVersion: "school-network-exchange-v1",
    episodeId: "private-episode",
    approvedPromoVersionId: "private-audio",
    createdBy: { email: "teacher@example.test" },
    requests: []
  }, { activeOrganisationId: "school-b" });
  assert.equal(redacted.sourceSchool.name, "School A");
  assert.equal(redacted.ownOffer, false);
  assert.equal("episodeId" in redacted, false);
  assert.equal("approvedPromoVersionId" in redacted, false);
  assert.equal("createdBy" in redacted, false);
  assert.equal("contributors" in redacted, false);
});

test("imported exchange audio is playable only while the exact grant and offer remain active", () => {
  const announcement = { sourceExchangeRequest: { targetOrganisationId: "school-b", status: "APPROVED", offer: { status: "AVAILABLE" } } };
  assert.equal(importedExchangeIsPlayable(announcement, "school-b"), true);
  assert.equal(importedExchangeIsPlayable(announcement, "school-c"), false);
  assert.equal(importedExchangeIsPlayable({ sourceExchangeRequest: { ...announcement.sourceExchangeRequest, status: "REVOKED" } }, "school-b"), false);
  assert.equal(importedExchangeIsPlayable({ sourceExchangeRequest: { ...announcement.sourceExchangeRequest, offer: { status: "PAUSED" } } }, "school-b"), false);
  assert.equal(importedExchangeIsPlayable({}, "school-b"), true);
});

test("intended use is meaningful and normalized", () => {
  assert.equal(normaliseSchoolExchangeIntendedUse("  Supervised   media studies lesson for Year 8. "), "Supervised media studies lesson for Year 8.");
  assert.throws(() => normaliseSchoolExchangeIntendedUse("For class"), /Describe how/);
});
