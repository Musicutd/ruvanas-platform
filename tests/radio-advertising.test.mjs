import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  applyRadioAdvertisingPolicy,
  campaignHasRadioTargets,
  estimateRadioAdvertisingPlays,
  normalizeRadioAdvertisingPolicy,
  radioAdvertisingBookingReadiness,
  radioAdvertisingConfigurationHash,
  radioTargetMatches,
  transitionRadioAdvertisingPolicy
} from "../lib/radio-advertising.mjs";

const policy = {
  id: "policy-1",
  status: "ACTIVE",
  revision: 1,
  configurationHash: "approved-hash",
  ...normalizeRadioAdvertisingPolicy({
    stationId: "station-1",
    channelId: "channel-1",
    pacingMode: "EVEN",
    maxSpotsPerBreak: 2,
    maxBreakSeconds: 45,
    minBreakGapMinutes: 10,
    maxAdvertisingSecondsPerHour: 60
  })
};

function insertion(id, minute, durationSeconds = 20, radioAdvertising = true) {
  return {
    scheduleItemId: id,
    campaignId: `campaign-${id}`,
    priority: "NORMAL",
    mandatory: false,
    durationSeconds,
    radioAdvertising,
    plannedStart: new Date(`2026-10-22T10:${String(minute).padStart(2, "0")}:00.000Z`)
  };
}

test("radio advertising policies are bounded, hash-stable and explicitly approved", () => {
  const normal = normalizeRadioAdvertisingPolicy(policy);
  assert.equal(normal.maxSpotsPerBreak, 2);
  assert.equal(radioAdvertisingConfigurationHash(normal), radioAdvertisingConfigurationHash({ ...normal }));
  assert.equal(transitionRadioAdvertisingPolicy("DRAFT", "ACTIVATE"), "ACTIVE");
  assert.equal(transitionRadioAdvertisingPolicy("ACTIVE", "PAUSE"), "PAUSED");
  assert.throws(() => transitionRadioAdvertisingPolicy("DRAFT", "PAUSE"), /not available/i);
  assert.throws(() => normalizeRadioAdvertisingPolicy({ ...policy, maxSpotsPerBreak: 20 }), /between 1 and 12/i);
});

test("radio-targeted campaigns fail closed without an active approved policy", () => {
  const ordinary = insertion("ordinary", 0, 10, false);
  const commercial = insertion("commercial", 0);
  const result = applyRadioAdvertisingPolicy({ insertions: [ordinary, commercial], policy: null });
  assert.deepEqual(result.insertions.map((item) => item.scheduleItemId), ["ordinary"]);
  assert.equal(result.discarded[0].advertisingDecision, "NO_ACTIVE_RADIO_ADVERTISING_POLICY");
});

test("active policy makes deterministic breaks and enforces spot, break and hourly limits", () => {
  const result = applyRadioAdvertisingPolicy({
    insertions: [insertion("a", 0, 20), insertion("b", 1, 20), insertion("c", 2, 20), insertion("d", 10, 30)],
    policy
  });
  assert.deepEqual(result.insertions.map((item) => item.scheduleItemId), ["a", "b"]);
  assert.equal(result.insertions[0].advertising.position, 1);
  assert.equal(result.insertions[1].advertising.position, 2);
  assert.equal(result.breaks.length, 1);
  assert.deepEqual(result.discarded.map((item) => item.advertisingDecision), ["BREAK_SPOT_LIMIT", "HOURLY_ADVERTISING_LIMIT"]);
});

test("booking readiness requires approved inventory, creative, radio targets, dates and volume", () => {
  const campaign = {
    id: "campaign-1",
    status: "PUBLISHED",
    promoVersionId: "promo-1",
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-10-31T00:00:00.000Z"),
    targets: [{ targetType: "CHANNEL", channelId: "channel-1" }]
  };
  const order = {
    status: "APPROVED",
    campaign,
    creatives: [{ status: "APPROVED", promoVersionId: "promo-1" }],
    inventoryPackage: {
      status: "ACTIVE",
      maxPlays: 100,
      effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-10-31T00:00:00.000Z"),
      targets: [{ targetType: "CHANNEL", channelId: "channel-1" }]
    }
  };
  const ready = radioAdvertisingBookingReadiness({ order, stationId: "station-1", channelId: "channel-1", policy, committedPlays: 20, estimatedPlays: 50 });
  assert.equal(ready.ready, true);
  assert.equal(ready.availablePlays, 80);
  const secondChannel = radioAdvertisingBookingReadiness({
    order: {
      ...order,
      campaign: { ...campaign, targets: [{ targetType: "STATION", stationId: "station-1" }] },
      inventoryPackage: { ...order.inventoryPackage, targets: [{ targetType: "STATION", stationId: "station-1" }] }
    },
    endpoints: [{ stationId: "station-1", channelId: "channel-1" }, { stationId: "station-1", channelId: "channel-2" }],
    policies: [policy],
    estimatedPlays: 100
  });
  assert.match(secondChannel.blockers.join(" "), /Every targeted channel/i);
  order.creatives[0].status = "PENDING";
  assert.match(radioAdvertisingBookingReadiness({ order, channelId: "channel-1", policy }).blockers.join(" "), /creative/i);
});

test("radio targets and estimated placement volume reuse campaign schedules", () => {
  assert.equal(campaignHasRadioTargets({ targets: [{ targetType: "STATION", stationId: "station-1" }] }), true);
  assert.equal(radioTargetMatches({ targetType: "CHANNEL", channelId: "channel-1" }, { channelId: "channel-1" }), true);
  assert.equal(radioTargetMatches({ targetType: "CHANNEL", channelId: "channel-2" }, { channelId: "channel-1" }), false);
  assert.equal(estimateRadioAdvertisingPlays({
    effectiveFrom: new Date("2026-10-05T00:00:00.000Z"),
    effectiveTo: new Date("2026-10-05T00:00:00.000Z"),
    schedules: [{ weekday: 1, windowMode: "PLAYS_PER_HOUR", startMinute: 540, endMinute: 660, playsPerHour: 2 }]
  }), 4);
});

test("Stage 19.21 keeps tenant, approval, migration and evidence boundaries explicit", async () => {
  const [route, service, playerProgramming, migration, workspace] = await Promise.all([
    readFile(new URL("../app/api/radio-advertising/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/radio-advertising-service.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/player-programming.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261022000000_stage_19_21_radio_advertising/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/advertising/RadioAdvertisingWorkspace.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /organisationId: access\.organisation\.id/);
  assert.match(route, /canManageRadioAdvertising/);
  assert.match(route, /RADIO_ADVERTISING_POLICY_ACTIVATED/);
  assert.match(service, /eventType: "COMPLETED"/);
  assert.match(service, /Public audience analytics remain separate/);
  assert.match(playerProgramming, /radioAdvertisingPolicy/);
  assert.match(migration, /RadioAdvertisingPolicy_channel_station_org_fkey/);
  assert.match(migration, /CHECK \("maxSpotsPerBreak" BETWEEN 1 AND 12\)/);
  assert.match(workspace, /scheduled/);
  assert.match(workspace, /completed/);
});
