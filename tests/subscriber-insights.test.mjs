import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStationBreakdown,
  buildSubscriberBreakdowns,
  normaliseSubscriberInsightRange,
  subscriberInsightActions,
  subscriberInsightDates
} from "../lib/subscriber-insights.mjs";

function aggregate(overrides = {}) {
  return {
    playerId: "player-a",
    playerName: "Reception",
    locationId: "location-a",
    locationName: "Valletta",
    zoneId: "zone-a",
    zoneName: "Entrance",
    _sum: {
      playbackStartedCount: 10,
      playbackCompletedCount: 9,
      playbackFailedCount: 1,
      playbackInterruptedCount: 0,
      heartbeatCount: 120,
      ...overrides._sum
    },
    ...overrides
  };
}

test("subscriber insight shortcuts use controlled, inclusive UTC periods", () => {
  assert.equal(normaliseSubscriberInsightRange(14), 14);
  assert.equal(normaliseSubscriberInsightRange("90"), 90);
  assert.equal(normaliseSubscriberInsightRange(365), 30);
  assert.deepEqual(
    subscriberInsightDates(7, new Date("2026-09-03T18:00:00.000Z")),
    { from: "2026-08-28", to: "2026-09-03", days: 7 }
  );
});

test("subscriber breakdowns aggregate and rank tenant-scoped location and player rows", () => {
  const result = buildSubscriberBreakdowns([
    aggregate(),
    aggregate({
      playerId: "player-b",
      playerName: "Cafeteria",
      zoneId: "zone-b",
      zoneName: "Dining",
      _sum: { playbackStartedCount: 8, playbackCompletedCount: 8, playbackFailedCount: 0, playbackInterruptedCount: 0 }
    }),
    aggregate({
      playerId: "player-c",
      playerName: "Sliema",
      locationId: "location-b",
      locationName: "Sliema",
      zoneId: "zone-c",
      zoneName: "Main floor",
      _sum: { playbackStartedCount: 30, playbackCompletedCount: 29, playbackFailedCount: 0, playbackInterruptedCount: 1 }
    })
  ]);

  assert.deepEqual(result.locations.map((row) => row.name), ["Sliema", "Valletta"]);
  assert.equal(result.locations[1].completed, 17);
  assert.equal(result.locations[1].exceptions, 1);
  assert.equal(result.players[0].name, "Sliema");
  assert.equal(result.players[0].confirmationRate, 29 / 30);
});

test("station delivery is resolved through organisation-scoped channels", () => {
  const stations = buildStationBreakdown([
    { channelId: "channel-a", _count: { _all: 12 } },
    { channelId: "channel-b", _count: { _all: 4 } },
    { channelId: "foreign-channel", _count: { _all: 99 } }
  ], [
    { id: "channel-a", station: { id: "station-a", name: "Retail Radio", status: "ACTIVE" } },
    { id: "channel-b", station: { id: "station-a", name: "Retail Radio", status: "ACTIVE" } }
  ]);

  assert.deepEqual(stations, [{ id: "station-a", name: "Retail Radio", completed: 16, status: "ACTIVE" }]);
});

test("subscriber action centre recommends direct operational next steps", () => {
  const actions = subscriberInsightActions({
    players: { offlineNow: 2 },
    summary: {
      playbackStartedCount: 100,
      playbackCompletedCount: 90,
      playbackFailedCount: 3,
      playbackInterruptedCount: 2,
      confirmationRate: .9
    }
  });

  assert.deepEqual(actions.map((action) => action.code), [
    "OFFLINE_PLAYERS",
    "PLAYBACK_EXCEPTIONS",
    "CONFIRMATION_RATE"
  ]);
  assert.equal(actions[0].href, "/dashboard/players");
  assert.equal(actions[1].href, "/dashboard/support");
});
