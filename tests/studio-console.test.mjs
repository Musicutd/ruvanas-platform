import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveStudioDailyLog,
  normalizeStudioConsoleLayout,
  STUDIO_CONSOLE_LAYOUTS,
  STUDIO_CONSOLE_PANELS,
  safeStudioMixTiming,
  studioConsoleNowNext,
  studioMixDefaults,
  studioTimingToNextHardEvent,
  validateStudioMixPoints
} from "../lib/studio-console.mjs";
import { scanStudioBroadcastConnections } from "../lib/studio-broadcast-service.js";

test("console layouts retain critical status and bound panel sizing", () => {
  assert.deepEqual(normalizeStudioConsoleLayout({ preset: "PRESENTER", panels: ["NOTES", "NOTES", "UNKNOWN"], sizes: { NOTES: 9000 } }), {
    preset: "PRESENTER", panels: ["OUTPUT_HEALTH", "ON_AIR", "NOTES"], sizes: { NOTES: 1200 }
  });
});

test("every preset names rendered panels and custom views keep mandatory output status", async () => {
  const rendered = ["ON_AIR", "DAILY_LOG", "OUTPUT_HEALTH", "PREPARE", "CARTS", "RADIO_CLOCKS", "NOTES", "MIX_POINTS"];
  assert.deepEqual([...STUDIO_CONSOLE_PANELS].sort(), rendered.sort());
  for (const panels of Object.values(STUDIO_CONSOLE_LAYOUTS)) {
    assert.ok(panels.includes("ON_AIR") && panels.includes("OUTPUT_HEALTH"));
  }
  assert.deepEqual(normalizeStudioConsoleLayout({ preset: "COMPACT", panels: ["CARTS", "CARTS", "MIC"], sizes: { CARTS: 640, MIC: 900 } }), {
    preset: "COMPACT", panels: ["OUTPUT_HEALTH", "ON_AIR", "CARTS"], sizes: { CARTS: 640 }
  });
  const [ui, css] = await Promise.all([
    readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/studio-pro.module.css", import.meta.url), "utf8")
  ]);
  assert.match(ui, /data-panels=\{data\.layout\.panels\.join\(" "\)\}/);
  assert.match(ui, /savePanels\(data\.layout\.panels/);
  assert.match(css, /data-panels~="CARTS"/);
  assert.match(css, /--panel-5-width/);
  assert.doesNotMatch(css, /data-preset="COMPACT"/);
});

test("mix points reject out of bounds and safely fall back", () => {
  assert.equal(validateStudioMixPoints([{ type: "CUE_IN", positionMs: 400 }, { type: "END", positionMs: 200 }], 1000).valid, false);
  assert.equal(safeStudioMixTiming([{ type: "END", positionMs: 1001 }], 1000).fallback, true);
  assert.deepEqual(safeStudioMixTiming([{ type: "CUE_IN", positionMs: 20 }, { type: "INTRO_END", positionMs: 250 }, { type: "END", positionMs: 950 }], 1000), {
    cueInMs: 20, introEndMs: 250, mixStartMs: null, fadeStartMs: null, endMs: 950, fallback: false
  });
});

test("valid mix points supply bounded prepare defaults without changing the source", () => {
  assert.deepEqual(studioMixDefaults([{ type: "CUE_IN", positionMs: 1200 }, { type: "FADE_START", positionMs: 8000 }, { type: "END", positionMs: 9000 }], 10000), { cueInMs: 1200, cueOutMs: 9000, fadeOutMs: 1000 });
  assert.deepEqual(studioMixDefaults([{ type: "END", positionMs: 12000 }], 10000), {});
});

test("now next and after next use the server queue ordering", () => {
  const output = studioConsoleNowNext({ items: [
    { id: "c", area: "LIVE", status: "READY", position: 2 },
    { id: "a", area: "LIVE", status: "ON_AIR", position: 0 },
    { id: "b", area: "LIVE", status: "READY", position: 1 }
  ] });
  assert.equal(output.onAir.id, "a");
  assert.equal(output.next.id, "b");
  assert.equal(output.afterNext.id, "c");
});

test("Daily Log keeps planned timing distinct from verified play events", () => {
  const log = deriveStudioDailyLog({
    dayStart: "2026-09-17T00:00:00Z", dayEnd: "2026-09-18T00:00:00Z",
    scheduled: [{ id: "a", sourceType: "CLOCK", label: "First hour", startsAt: "2026-09-17T10:00:00Z", durationMs: 3_600_000 }],
    campaigns: [{ id: "b", sourceType: "CAMPAIGN", label: "Fixed spot", startsAt: "2026-09-17T10:30:00Z", durationMs: 30_000, hardEvent: true }],
    proof: [{ id: "proof-1", eventType: "COMPLETED", occurredAt: "2026-09-17T10:30:05Z", trackTitle: "Actual spot" }]
  });
  assert.equal(log.planned.length, 2);
  assert.equal(log.actual.length, 1);
  assert.equal(log.planned[0].actualStartAt, null);
  assert.equal(log.planned[1].timingVarianceMs, 0);
  assert.equal(studioTimingToNextHardEvent(log, new Date("2026-09-17T10:10:00Z")).deltaMs, -1_800_000);
});

test("Console routes reuse Studio authority and keep tenant-scoped writes behind Pro", async () => {
  const [route, monitor, hub, migration] = await Promise.all([
    readFile(new URL("../app/api/studio/console/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/monitor/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/StudioHubClient.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261120000000_studio_broadcast_console/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(route, /requireActiveStudio\(ORGANISATION_CONTENT_ROLES\)/);
  assert.match(route, /studioProEnabled/);
  assert.match(route, /const organisationId = access\.organisation\.id/);
  assert.match(route, /productFamily: access\.entitlements\.planProductFamily/);
  assert.doesNotMatch(route, /FIRE_CART|START_BROADCAST/);
  assert.match(monitor, /monitor \/>/);
  assert.match(hub, /BroadcastConsoleClient/);
  for (const name of ["StudioConsolePreference", "StudioCartBank", "StudioCart", "StudioMixPoint", "StudioPresenterNote"]) assert.match(migration, new RegExp(`CREATE TABLE "${name}"`));
});

test("existing Studio destination links stay standby without verified Manual output", async () => {
  const writes = [];
  const database = {
    studioBroadcastSessionDestination: {
      findMany: async () => [{ sessionId: "session-1", destinationId: "destination-1", state: "CONNECTED" }],
      updateMany: (input) => { writes.push(["links", input]); return Promise.resolve({ count: 1 }); }
    },
    studioBroadcastDestination: {
      updateMany: (input) => { writes.push(["destinations", input]); return Promise.resolve({ count: 1 }); }
    },
    $transaction: (operations) => Promise.all(operations)
  };
  const result = await scanStudioBroadcastConnections(database);
  assert.deepEqual(result, { scanned: 1, connected: 0, reconnecting: 0, failed: 0, waitingForOutput: 1 });
  assert.equal(writes[0][1].data.state, "STANDBY");
  assert.equal(writes[1][1].data.connectionState, "STANDBY");
});

test("live commands cannot mark an item on air or start distribution without a bridge", async () => {
  const [playout, broadcast, manualUi, broadcastUi] = await Promise.all([
    readFile(new URL("../app/api/studio/playout/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/studio/broadcast/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/ManualPlayoutClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/StudioBroadcastClient.js", import.meta.url), "utf8")
  ]);
  assert.match(playout, /assertStudioManualOutputBridge\(\)/);
  assert.doesNotMatch(playout, /status: "ON_AIR", startedAt/);
  assert.match(broadcast, /if \(input\.action === "START_BROADCAST"\) \{\s*assertStudioManualOutputBridge\(\)/);
  assert.match(manualUi, /disabled=\{busy \|\| !manualOutputConnected\}/);
  assert.match(broadcastUi, /disabled=\{busy\|\|!selected\.length\|\|!data\.manualOutput\?\.connected\}/);
});

test("Console presenter actions reuse the governed Manual Playout queue and keep the monitor read only", async () => {
  const [consoleUi, playout] = await Promise.all([
    readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/studio/playout/route.js", import.meta.url), "utf8")
  ]);
  assert.match(consoleUi, /if \(monitor \|\| !session \|\| busy\) return/);
  assert.match(consoleUi, /fetch\("\/api\/studio\/playout"/);
  assert.match(consoleUi, /expectedRevision: session\.revision/);
  assert.match(consoleUi, /prepareQueue\("REORDER"/);
  assert.match(consoleUi, /prepareQueue\("LOCK"/);
  assert.match(consoleUi, /prepareQueue\("SEND_NEXT"/);
  assert.match(consoleUi, /hardEventTiming\?\.deltaMs < 0/);
  assert.match(playout, /planStudioFutureReorder\(session\.items, input\.itemId, input\.position\)/);
});
