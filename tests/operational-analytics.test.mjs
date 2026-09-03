import test from "node:test";
import assert from "node:assert/strict";
import {
  analyticsHourBucket,
  buildOperationalAnalyticsDeltas,
  normaliseOperationalAnalyticsFilters,
  operationalAnalyticsCsv,
  operationalAnalyticsSummary,
  signAnalyticsExport,
  verifyAnalyticsExport
} from "../lib/operational-analytics.mjs";

test("operational analytics enforces a bounded inclusive date range", () => {
  assert.deepEqual(
    normaliseOperationalAnalyticsFilters({ from: "2026-08-01", to: "2026-08-03" }),
    { from: "2026-08-01", to: "2026-08-03", days: 3 }
  );
  assert.throws(() => normaliseOperationalAnalyticsFilters({ from: "2026-08-03", to: "2026-08-01" }), /after/);
  assert.throws(() => normaliseOperationalAnalyticsFilters({ from: "2026-01-01", to: "2026-08-01" }), /93 days/);
  assert.throws(() => normaliseOperationalAnalyticsFilters({ from: "2026-02-30", to: "2026-03-01" }), /valid calendar/);
});

test("analytics events collapse into tenant and player hourly buckets", () => {
  const deltas = buildOperationalAnalyticsDeltas({
    intents: [{
      organisationId: "org-a", playerId: "player-a", player: { name: "Lobby" },
      locationId: "location-a", locationName: "Campus", zoneId: "zone-a", zone: { name: "Reception" },
      campaignId: "campaign-a", schoolBroadcastSlotId: null, plannedStart: new Date("2026-08-28T10:15:00Z")
    }],
    events: [
      { organisationId: "org-a", playerId: "player-a", playerName: "Lobby", locationName: "Campus", zoneId: "zone-a", zoneName: "Reception", zone: { locationId: "location-a" }, itemType: "PROMO", eventType: "STARTED", occurredAt: new Date("2026-08-28T10:16:00Z") },
      { organisationId: "org-a", playerId: "player-a", playerName: "Lobby", locationName: "Campus", zoneId: "zone-a", zoneName: "Reception", zone: { locationId: "location-a" }, itemType: "PROMO", eventType: "COMPLETED", occurredAt: new Date("2026-08-28T10:16:20Z") },
      { organisationId: "org-b", playerId: "player-b", playerName: "Other", locationName: "Other", zoneId: "zone-b", zoneName: "Other", zone: { locationId: "location-b" }, itemType: "MUSIC", eventType: "FAILED", occurredAt: new Date("2026-08-28T10:20:00Z") }
    ]
  });
  assert.equal(deltas.length, 2);
  const orgA = deltas.find((row) => row.organisationId === "org-a");
  assert.equal(orgA.bucketStart.toISOString(), "2026-08-28T10:00:00.000Z");
  assert.equal(orgA.plannedCount, 1);
  assert.equal(orgA.campaignPlannedCount, 1);
  assert.equal(orgA.playbackStartedCount, 1);
  assert.equal(orgA.playbackCompletedCount, 1);
  assert.equal(orgA.promoCompletedCount, 1);
  assert.equal(deltas.find((row) => row.organisationId === "org-b").playbackFailedCount, 1);
});

test("summary and CSV keep operational evidence distinct from audience measurement", () => {
  const rows = [{
    date: "2026-08-28", plannedCount: 4, campaignPlannedCount: 3, schoolPlannedCount: 1,
    playbackStartedCount: 3, playbackCompletedCount: 2, playbackFailedCount: 1,
    playbackInterruptedCount: 0, musicCompletedCount: 0, promoCompletedCount: 1,
    schoolCompletedCount: 1, heartbeatCount: 120
  }];
  const summary = operationalAnalyticsSummary(rows);
  assert.equal(summary.confirmationRate, 2 / 3);
  const csv = operationalAnalyticsCsv({ days: rows });
  assert.match(csv, /Device-confirmed operational evidence/);
  assert.match(csv, /"No"/);
  assert.doesNotMatch(csv, /listeners|reach/i);
});

test("customer CSV includes professional location, player, and station sections when available", () => {
  const csv = operationalAnalyticsCsv({
    days: [],
    breakdowns: {
      locations: [{ name: "Valletta", completed: 19, exceptions: 1, confirmationRate: .95 }],
      players: [{ name: "Reception", completed: 10, exceptions: 0, confirmationRate: 1 }],
      stations: [{ name: "Ruvanas Radio", completed: 19 }]
    }
  });

  assert.match(csv, /Location performance/);
  assert.match(csv, /Player performance/);
  assert.match(csv, /Station performance/);
  assert.match(csv, /"Valletta","19","1","95%"/);
});

test("analytics export links are signed, scoped, and expiring", () => {
  const secret = "a".repeat(64);
  const input = { jobId: "job-a", organisationId: "org-a", requestedByUserId: "user-a", expiresAt: new Date("2026-08-29T00:00:00Z") };
  const token = signAnalyticsExport(input, secret);
  assert.equal(verifyAnalyticsExport(input, token, secret, new Date("2026-08-28T00:00:00Z")), true);
  assert.equal(verifyAnalyticsExport({ ...input, organisationId: "org-b" }, token, secret, new Date("2026-08-28T00:00:00Z")), false);
  assert.equal(verifyAnalyticsExport(input, token, secret, new Date("2026-08-30T00:00:00Z")), false);
});

test("hour buckets are canonical UTC hours", () => {
  assert.equal(analyticsHourBucket("2026-08-28T23:59:59.999Z").toISOString(), "2026-08-28T23:00:00.000Z");
});

test("a realistic event volume stays collapsed into bounded hourly rows", () => {
  const events = [];
  for (let player = 0; player < 100; player += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      for (let event = 0; event < 4; event += 1) {
        events.push({
          organisationId: "org-volume",
          playerId: `player-${player}`,
          playerName: `Player ${player}`,
          locationName: "Campus",
          zoneId: `zone-${player}`,
          zoneName: `Zone ${player}`,
          zone: { locationId: "location-volume" },
          itemType: event % 2 === 0 ? "MUSIC" : "PROMO",
          eventType: event === 0 ? "STARTED" : "COMPLETED",
          occurredAt: new Date(Date.UTC(2026, 7, 28, hour, event, 0))
        });
      }
    }
  }

  const deltas = buildOperationalAnalyticsDeltas({ events });
  assert.equal(events.length, 9_600);
  assert.equal(deltas.length, 2_400);
  assert.equal(deltas.reduce((total, row) => total + row.playbackCompletedCount, 0), 7_200);
});
