import assert from "node:assert/strict";
import test from "node:test";
import { compileCampaignPlayout } from "../lib/campaign-playout.mjs";

const player = {
  id: "player-1",
  organisationId: "org-1",
  zoneId: "zone-1",
  zone: {
    location: {
      id: "location-1",
      brandId: "brand-1",
      timezone: "Europe/Malta",
      groupMemberships: [{ locationGroupId: "group-1" }]
    }
  }
};

function campaign(id, overrides = {}) {
  return {
    id,
    organisationId: "org-1",
    name: `Campaign ${id}`,
    status: "PUBLISHED",
    priority: "NORMAL",
    mandatory: false,
    respectOpeningHours: true,
    effectiveFrom: new Date("2026-08-27T00:00:00.000Z"),
    effectiveTo: new Date("2026-08-28T00:00:00.000Z"),
    publicationRevision: 1,
    publishedConfigurationHash: "a".repeat(64),
    minSamePromoGapMinutes: 15,
    minAnyPromoGapMinutes: 2,
    targets: [{ targetType: "LOCATION", locationId: "location-1" }],
    rule: { exactTimeHardStart: false },
    schedules: [{ weekday: 4, windowMode: "PLAYS_PER_HOUR", startMinute: 600, endMinute: 660, playsPerHour: 2 }],
    promoVersion: {
      id: `version-${id}`,
      status: "APPROVED",
      durationSeconds: 20,
      promoAsset: { id: `promo-${id}`, name: `Promo ${id}`, status: "ACTIVE" },
      mediaAsset: { id: `media-${id}`, organisationId: "org-1", status: "READY", durationSeconds: 20 }
    },
    ...overrides
  };
}

test("published targeted campaigns compile deterministic five-minute insertions", () => {
  const input = {
    campaigns: [campaign("one")],
    player,
    instant: new Date("2026-08-27T08:02:00.000Z"),
    isLocationOpenAt: () => true
  };
  const first = compileCampaignPlayout(input);
  const second = compileCampaignPlayout(input);
  assert.equal(first.insertions.length, 1);
  assert.equal(first.insertions[0].plannedStart.toISOString(), "2026-08-27T08:00:00.000Z");
  assert.equal(first.insertions[0].scheduleItemId, second.insertions[0].scheduleItemId);
  assert.match(first.insertions[0].scheduleItemId, /^[0-9a-f]{64}$/);
});

test("mandatory higher-priority campaigns win conflicting insertion slots", () => {
  const normal = campaign("normal");
  const mandatory = campaign("mandatory", { mandatory: true, priority: "VERY_HIGH" });
  const result = compileCampaignPlayout({
    campaigns: [normal, mandatory],
    player,
    instant: new Date("2026-08-27T08:02:00.000Z"),
    isLocationOpenAt: () => true
  });
  assert.deepEqual(result.insertions.map((item) => item.campaignId), ["mandatory"]);
  assert.deepEqual(result.discarded.map((item) => item.campaignId), ["normal"]);
});

test("target, approved-version, and opening-hours checks are enforced at compilation", () => {
  const result = compileCampaignPlayout({
    campaigns: [
      campaign("closed"),
      campaign("wrong-zone", { targets: [{ targetType: "ZONE", zoneId: "zone-2" }] }),
      campaign("draft-audio", { promoVersion: { ...campaign("draft-audio").promoVersion, status: "DRAFT" } })
    ],
    player,
    instant: new Date("2026-08-27T08:02:00.000Z"),
    isLocationOpenAt: () => false
  });
  assert.deepEqual(result.insertions, []);
});

test("superseded approved versions remain pinned to already-published campaigns", () => {
  const pinned = campaign("pinned", {
    promoVersion: { ...campaign("pinned").promoVersion, status: "SUPERSEDED" }
  });
  const result = compileCampaignPlayout({
    campaigns: [pinned],
    player,
    instant: new Date("2026-08-27T08:02:00.000Z")
  });
  assert.equal(result.insertions.length, 1);
  assert.equal(result.insertions[0].promoVersionId, "version-pinned");
});
