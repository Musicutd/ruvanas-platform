import assert from "node:assert/strict";
import test from "node:test";
import {
  compileSchoolRadioPlayout,
  mergeSharedInsertions,
  schoolPlayoutIntentCreateData,
  consentIsCurrent,
  transitionSchoolAnnouncement,
  transitionSchoolEpisode,
  validateEpisodePublication,
  validateSchoolBroadcastSlot
} from "../lib/school-radio.mjs";

const player = {
  id: "player-1",
  organisationId: "org-1",
  zoneId: "zone-1",
  zone: {
    locationId: "location-1",
    location: { id: "location-1", name: "Ruvanas School", timezone: "Europe/Malta", groupMemberships: [] }
  }
};

function approvedSlot(overrides = {}) {
  return {
    id: "slot-1",
    organisationId: "org-1",
    announcementId: "announcement-1",
    locationId: "location-1",
    zoneId: null,
    startsAt: new Date("2026-09-01T08:01:00.000Z"),
    endsAt: new Date("2026-09-01T08:03:00.000Z"),
    status: "APPROVED",
    revision: 1,
    announcement: {
      id: "announcement-1",
      organisationId: "org-1",
      title: "Morning notice",
      status: "APPROVED",
      policyVersion: "school-radio-v1",
      promoVersion: {
        id: "version-1",
        status: "APPROVED",
        durationSeconds: 20,
        promoAsset: { id: "promo-1", name: "Morning notice audio", status: "ACTIVE" },
        mediaAsset: { id: "media-1", organisationId: "org-1", status: "READY", durationSeconds: 20 }
      }
    },
    ...overrides
  };
}

test("announcement workflow requires review before approval", () => {
  assert.equal(transitionSchoolAnnouncement({ currentStatus: "DRAFT", action: "SUBMIT" }).status, "IN_REVIEW");
  assert.equal(transitionSchoolAnnouncement({ currentStatus: "IN_REVIEW", action: "APPROVE" }).status, "APPROVED");
  assert.throws(() => transitionSchoolAnnouncement({ currentStatus: "DRAFT", action: "APPROVE" }), /cannot be changed/);
  assert.throws(() => transitionSchoolAnnouncement({ currentStatus: "IN_REVIEW", action: "REJECT" }), /notes are required/);
});

test("broadcast slots require exactly one target and a positive time range", () => {
  assert.equal(validateSchoolBroadcastSlot({ locationId: "location-1", startsAt: "2026-09-01T08:00:00Z", endsAt: "2026-09-01T08:05:00Z" }).locationId, "location-1");
  assert.throws(() => validateSchoolBroadcastSlot({ locationId: "location-1", zoneId: "zone-1", startsAt: "2026-09-01T08:00:00Z", endsAt: "2026-09-01T08:05:00Z" }), /exactly one/);
  assert.throws(() => validateSchoolBroadcastSlot({ zoneId: "zone-1", startsAt: "2026-09-01T08:05:00Z", endsAt: "2026-09-01T08:00:00Z" }), /after its start/);
});

test("only approved, tenant-owned, targeted announcements enter the player manifest", () => {
  const result = compileSchoolRadioPlayout({ slots: [approvedSlot()], player, instant: new Date("2026-09-01T08:02:00.000Z") });
  assert.equal(result.insertions.length, 1);
  assert.equal(result.insertions[0].announcementTitle, "Morning notice");
  assert.match(result.insertions[0].scheduleItemId, /^[0-9a-f]{64}$/);
  const excluded = compileSchoolRadioPlayout({
    slots: [
      approvedSlot({ id: "wrong-zone", locationId: null, zoneId: "zone-2" }),
      approvedSlot({ id: "draft", announcement: { ...approvedSlot().announcement, status: "DRAFT" } }),
      approvedSlot({ id: "other-tenant", announcement: { ...approvedSlot().announcement, organisationId: "org-2" } })
    ],
    player,
    instant: new Date("2026-09-01T08:02:00.000Z")
  });
  assert.deepEqual(excluded.insertions, []);
});

test("school playout intents are tenant snapshots without a campaign", () => {
  const insertion = compileSchoolRadioPlayout({ slots: [approvedSlot()], player, instant: new Date("2026-09-01T08:02:00.000Z") }).insertions[0];
  const data = schoolPlayoutIntentCreateData({ insertion, player, channelId: "channel-1" });
  assert.equal(data.campaignId, null);
  assert.equal(data.schoolBroadcastSlotId, "slot-1");
  assert.equal(data.locationId, "location-1");
});

test("approved school announcements take precedence in the shared insertion scheduler", () => {
  const schoolPlayout = compileSchoolRadioPlayout({ slots: [approvedSlot()], player, instant: new Date("2026-09-01T08:02:00.000Z") });
  const campaign = { scheduleItemId: "campaign", plannedStart: new Date("2026-09-01T08:01:30.000Z") };
  const merged = mergeSharedInsertions({ campaignPlayout: { insertions: [campaign], discarded: [] }, schoolPlayout });
  assert.deepEqual(merged.campaignPlayout.insertions, []);
  assert.deepEqual(merged.campaignPlayout.discarded, [campaign]);
  assert.equal(merged.schoolPlayout.insertions.length, 1);
});

test("episode submissions must exist before staff moderation", () => {
  assert.throws(() => transitionSchoolEpisode({ currentStatus: "DRAFT", action: "SUBMIT" }), /audio submission/);
  assert.equal(transitionSchoolEpisode({ currentStatus: "DRAFT", action: "SUBMIT", hasSubmission: true }).status, "IN_REVIEW");
  assert.equal(transitionSchoolEpisode({ currentStatus: "IN_REVIEW", action: "APPROVE", hasSubmission: true }).status, "APPROVED");
  assert.throws(() => transitionSchoolEpisode({ currentStatus: "IN_REVIEW", action: "REQUEST_CHANGES", hasSubmission: true }), /notes are required/);
});

test("consent records expire and revocation takes effect immediately", () => {
  const instant = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(consentIsCurrent({ status: "GRANTED", expiresAt: "2026-09-02T00:00:00.000Z", revokedAt: null }, instant), true);
  assert.equal(consentIsCurrent({ status: "GRANTED", expiresAt: "2026-08-31T00:00:00.000Z", revokedAt: null }, instant), false);
  assert.equal(consentIsCurrent({ status: "GRANTED", expiresAt: null, revokedAt: instant }, instant), false);
});

test("school episodes remain private unless entitlement, approval, and every consent are present", () => {
  assert.deepEqual(validateEpisodePublication({ publicationScope: "INTERNAL_ONLY", episodeStatus: "DRAFT" }), { allowed: true, scope: "INTERNAL_ONLY" });
  assert.throws(() => validateEpisodePublication({ publicationScope: "PUBLIC", episodeStatus: "APPROVED", contributorConsents: [{ status: "GRANTED" }] }), /not enabled/);
  assert.throws(() => validateEpisodePublication({ publicationScope: "PUBLIC", episodeStatus: "IN_REVIEW", publicPublishingEnabled: true, contributorConsents: [{ status: "GRANTED" }] }), /staff-approved/);
  assert.throws(() => validateEpisodePublication({ publicationScope: "PUBLIC", episodeStatus: "APPROVED", publicPublishingEnabled: true, contributorConsents: [{ status: "PENDING" }] }), /Every student/);
  assert.equal(validateEpisodePublication({ publicationScope: "PUBLIC", episodeStatus: "APPROVED", publicPublishingEnabled: true, contributorConsents: [{ status: "GRANTED", expiresAt: null, revokedAt: null }] }).scope, "PUBLIC");
});
