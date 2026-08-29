import test from "node:test";
import assert from "node:assert/strict";
import { crossMediaConfigurationHash, crossMediaReadiness } from "../lib/retail-media-cross-media.mjs";

function base(overrides = {}) {
  return {
    orderId: "order-1",
    orderStatus: "APPROVED",
    inventory: {
      id: "inventory-1",
      status: "ACTIVE",
      effectiveFrom: "2026-09-01",
      effectiveTo: "2026-09-30",
      targetZoneIds: ["zone-1", "zone-2"],
      dayparts: [
        { weekday: 1, startMinute: 540, endMinute: 1020 },
        { weekday: 2, startMinute: 0, endMinute: 120 }
      ]
    },
    audio: {
      required: true,
      approvedPromoVersionIds: ["promo-1"],
      campaign: {
        id: "campaign-1",
        status: "PUBLISHED",
        promoVersionId: "promo-1",
        effectiveFrom: "2026-09-01",
        effectiveTo: "2026-09-30",
        targetZoneIds: ["zone-1"],
        schedules: [{ weekday: 1, windowMode: "PLAYS_PER_HOUR", startMinute: 600, endMinute: 900 }]
      }
    },
    visual: {
      required: true,
      approvedAssetIds: ["visual-1"],
      playlists: [{
        id: "playlist-1",
        name: "Shop screens",
        status: "PUBLISHED",
        version: 3,
        startsAt: "2026-09-01T00:00:00Z",
        endsAt: "2026-09-30T23:59:59Z",
        activeDays: [1],
        dailyStartMinute: 600,
        dailyEndMinute: 900,
        assetIds: ["visual-1"],
        deviceZoneIds: ["zone-2"]
      }]
    },
    ...overrides
  };
}

test("a shared order can activate when audio and visual delivery are independently eligible", () => {
  const result = crossMediaReadiness(base());
  assert.equal(result.canActivate, true);
  assert.equal(result.audio.ready, true);
  assert.equal(result.visual.ready, true);
  assert.match(result.configurationHash, /^[0-9a-f]{64}$/);
  assert.match(result.evidenceNotice, /do not measure audience/);
});

test("targets and dates cannot escape purchased inventory", () => {
  const input = base();
  input.audio.campaign.targetZoneIds = ["zone-3"];
  input.visual.playlists[0].endsAt = "2026-10-01T00:00:00Z";
  const result = crossMediaReadiness(input);
  assert.equal(result.canActivate, false);
  assert.match(result.audio.blockers.join(" "), /outside the purchased inventory/);
  assert.match(result.visual.blockers.join(" "), /dates must stay inside/);
});

test("daypart validation handles exact-time and overnight campaign segments", () => {
  const input = base();
  input.inventory.dayparts[0].endMinute = 1440;
  input.audio.campaign.schedules = [
    { weekday: 1, windowMode: "EXACT_TIME", exactMinute: 600 },
    { weekday: 1, windowMode: "INTERVAL", startMinute: 1000, endMinute: 60 }
  ];
  const result = crossMediaReadiness(input);
  assert.equal(result.audio.ready, true);
  input.audio.campaign.schedules[1].endMinute = 180;
  assert.match(crossMediaReadiness(input).audio.blockers.join(" "), /outside the purchased dayparts/);
});

test("single-medium orders do not invent a missing surface", () => {
  const input = base();
  input.visual = { required: false, approvedAssetIds: [], playlists: [] };
  const result = crossMediaReadiness(input);
  assert.equal(result.canActivate, true);
  assert.deepEqual(result.visual, { required: false, ready: true, blockers: [] });
});

test("configuration hashes are stable for object key order", () => {
  assert.equal(crossMediaConfigurationHash({ b: 2, a: 1 }), crossMediaConfigurationHash({ a: 1, b: 2 }));
});
