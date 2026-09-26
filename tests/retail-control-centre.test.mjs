import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveRetailControlCentre, loadRetailControlCentre } from "../lib/retail-dashboard-service.mjs";

const now = new Date("2026-09-23T12:00:00.000Z");
const mode = { id: "mode-1", name: "Warm Mix", status: "ACTIVE" };

function location({ closed = false, withZone = true } = {}) {
  return {
    id: "shop-1", name: "Main Street", city: "Valletta", status: "ACTIVE", timezone: "Europe/Malta", brandId: null, groupMemberships: [],
    openingHours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, isClosed: closed, opensAtMinute: 0, closesAtMinute: 1439 })), openingExceptions: [],
    zones: withZone ? [{ id: "zone-1", name: "Sales floor", status: "ACTIVE", channelAssignments: [{ channel: { id: "channel-1", name: "Shop channel", status: "ACTIVE", autoDjPolicy: { rightsUse: "RETAIL_RADIO", state: "ACTIVE", enabled: true, playbackPolicy: "FOLLOW_LOCATION_HOURS", defaultMusicMode: mode, backupMusicMode: null } } }] }] : []
  };
}

function player({ heartbeatAt = "2026-09-23T11:59:40.000Z", playbackAt = "2026-09-23T11:59:00.000Z", sourceStatus = "CONNECTED" } = {}) {
  return {
    id: "player-1", name: "Front counter", zoneId: "zone-1", status: "ONLINE", enrolledAt: new Date("2026-09-01T00:00:00.000Z"), lastHeartbeatAt: heartbeatAt ? new Date(heartbeatAt) : null,
    heartbeatSamples: heartbeatAt ? [{ observedAt: new Date(heartbeatAt), sourceStatus }] : [],
    proofOfPlayEvents: playbackAt ? [{ occurredAt: new Date(playbackAt), eventType: "STARTED", trackTitle: "Track A", trackArtist: "Artist A", manifestVersion: "1" }] : []
  };
}

test("new subscriber gets a real setup state without fabricated music or playback", () => {
  const result = deriveRetailControlCentre({ now, role: "OWNER" });
  assert.equal(result.overallState, "SETUP");
  assert.equal(result.counts.stores, 0);
  assert.equal(result.recentPlayback, null);
  assert.equal(result.timeline.length, 0);
  assert.equal(result.canManage, true);
});

test("a prepared shop without a listening area remains in setup", () => {
  const result = deriveRetailControlCentre({ locations: [location({ withZone: false })], now });
  assert.equal(result.overallState, "SETUP");
  assert.equal(result.counts.attentionStores, 1);
  assert.equal(result.counts.players, 0);
});

test("large portfolios disclose when the overview is bounded", () => {
  const locations = Array.from({ length: 200 }, (_, index) => ({ ...location({ withZone: false }), id: `shop-${index}` }));
  const result = deriveRetailControlCentre({ locations, now });
  assert.equal(result.limited, true);
});

test("healthy shop shows configured sound separately from recent playback proof", () => {
  const result = deriveRetailControlCentre({ locations: [location()], players: [player()], now, role: "VIEWER" });
  assert.equal(result.overallState, "HEALTHY");
  assert.equal(result.counts.readyPlayers, 1);
  assert.equal(result.configuredSound, "Warm Mix");
  assert.equal(result.recentPlayback.title, "Track A");
  assert.equal(result.canManage, false);
});

test("stale player evidence is not presented as confirmed audio", () => {
  const result = deriveRetailControlCentre({ locations: [location()], players: [player({ heartbeatAt: "2026-09-23T11:00:00.000Z", playbackAt: "2026-09-23T11:00:00.000Z" })], now });
  assert.equal(result.overallState, "ATTENTION");
  assert.equal(result.counts.readyPlayers, 0);
  assert.equal(result.recentPlayback, null);
  assert.equal(result.counts.attentionStores, 1);
});

test("closed shops are labelled closed rather than failing their player", () => {
  const result = deriveRetailControlCentre({ locations: [location({ closed: true })], players: [player()], now });
  assert.equal(result.overallState, "CLOSED");
  assert.equal(result.stores[0].openingState, "CLOSED");
  assert.equal(result.counts.attentionStores, 0);
});

test("today timeline and targeted promotions remain store-scoped", () => {
  const result = deriveRetailControlCentre({
    locations: [location()], players: [player()], now,
    schedules: [{ id: "schedule-1", version: 1, status: "PUBLISHED", locationId: "shop-1", zoneId: null, effectiveFrom: null, effectiveTo: null, slots: [{ id: "slot-1", weekday: 3, startMinute: 960, endMinute: 1020, priority: 0, musicMode: mode }] }],
    campaigns: [{ id: "campaign-1", effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveTo: new Date("2026-09-30T00:00:00Z"), targets: [{ targetType: "LOCATION", locationId: "shop-1" }] }, { id: "campaign-other", effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveTo: new Date("2026-09-30T00:00:00Z"), targets: [{ targetType: "LOCATION", locationId: "shop-other" }] }]
  });
  assert.equal(result.counts.promotionsToday, 1);
  assert.equal(result.timeline[0].time, "16:00");
  assert.equal(result.timeline[0].storeName, "Main Street");
});

test("database reads are tenant-scoped and avoid querying disabled signage", async () => {
  const queries = [];
  const database = {
    location: { findMany: async (args) => { queries.push(args); return []; } },
    player: { findMany: async (args) => { queries.push(args); return []; } },
    musicSchedule: { findMany: async (args) => { queries.push(args); return []; } },
    campaign: { findMany: async (args) => { queries.push(args); return []; } },
    musicMode: { count: async (args) => { queries.push(args); return 0; } },
    digitalSignageDevice: { findMany: async () => { throw new Error("Signage must be gated"); } }
  };
  const result = await loadRetailControlCentre(database, { organisationId: "tenant-1", role: "VIEWER", entitlements: { digitalSignageEnabled: false }, now });
  assert.equal(result.counts.stores, 0);
  assert.equal(queries.length, 5);
  assert.ok(queries.every((query) => query.where.organisationId === "tenant-1"));
  assert.ok(queries.filter((query) => "take" in query).every((query) => query.take <= 600));
});

test("Retail home keeps everyday actions visible and technical evidence optional", async () => {
  const client = await readFile(new URL("../app/dashboard/retail/RetailControlCentre.js", import.meta.url), "utf8");
  assert.match(client, /What would you like to do\?/);
  assert.match(client, /AutoDJ & shop music/);
  assert.match(client, /Check shop players/);
  assert.match(client, /More about this shop/);
  assert.match(client, /Schedules, reports and more tools/);
  assert.match(client, /Player ready/);
  assert.doesNotMatch(client, /shops with playback confirmed/);
});
