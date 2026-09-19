import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localMinuteToUtc } from "../lib/advanced-scheduler.mjs";
import {
  deriveStudioDailyLog,
  formatStudioLogTime,
  moveStudioConsolePanel,
  normalizeStudioConsoleLayout,
  reorderStudioConsolePanel,
  STUDIO_CONSOLE_LAYOUTS,
  STUDIO_CONSOLE_PANELS,
  safeStudioMixTiming,
  studioConsoleNowNext,
  studioClockBoundaryConflicts,
  studioProgrammeLogEntries,
  studioTimedPlaylistLogEntries,
  studioSpotBoard,
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
  assert.match(ui, /Children\.toArray\(children\)\.filter/);
  assert.match(ui, /panels\.sort\(\(left, right\) => layoutPanels\.indexOf/);
  assert.match(ui, /cloneElement\(panel/);
  assert.match(ui, /moveStudioConsolePanel\(layout, id, -1\)/);
  assert.match(css, /var\(--panel-width,320px\)/);
  assert.doesNotMatch(css, /order:var\(--panel-/);
  assert.doesNotMatch(css, /data-preset="COMPACT"/);
});

test("panel ordering moves only within a visible section and keeps saved widths", () => {
  const layout = { preset: "PRESENTER", panels: ["ON_AIR", "CARTS", "DAILY_LOG", "NOTES", "OUTPUT_HEALTH"], sizes: { CARTS: 640 } };
  assert.deepEqual(moveStudioConsolePanel(layout, "ON_AIR", 1), {
    preset: "PRESENTER", panels: ["DAILY_LOG", "CARTS", "ON_AIR", "NOTES", "OUTPUT_HEALTH"], sizes: { CARTS: 640 }
  });
  assert.deepEqual(moveStudioConsolePanel(layout, "CARTS", 1).panels, ["ON_AIR", "NOTES", "DAILY_LOG", "CARTS", "OUTPUT_HEALTH"]);
  assert.deepEqual(moveStudioConsolePanel(layout, "OUTPUT_HEALTH", 1).panels, layout.panels);
  assert.deepEqual(moveStudioConsolePanel(layout, "PREPARE", -1).panels, layout.panels);
  assert.deepEqual(moveStudioConsolePanel(layout, "CARTS", 0).panels, layout.panels);
});

test("drag reorder moves visible panels within their section without changing audio or widths", async () => {
  const layout = { preset: "PRESENTER", panels: ["ON_AIR", "CARTS", "DAILY_LOG", "NOTES", "OUTPUT_HEALTH"], sizes: { CARTS: 640 } };
  assert.deepEqual(reorderStudioConsolePanel(layout, "ON_AIR", "OUTPUT_HEALTH"), {
    ...layout, panels: ["DAILY_LOG", "CARTS", "OUTPUT_HEALTH", "NOTES", "ON_AIR"]
  });
  assert.deepEqual(reorderStudioConsolePanel(layout, "NOTES", "CARTS").panels, ["ON_AIR", "NOTES", "DAILY_LOG", "CARTS", "OUTPUT_HEALTH"]);
  assert.deepEqual(reorderStudioConsolePanel(layout, "ON_AIR", "CARTS").panels, layout.panels);
  assert.deepEqual(reorderStudioConsolePanel(layout, "PREPARE", "CARTS").panels, layout.panels);
  assert.deepEqual(reorderStudioConsolePanel(layout, "CARTS", "CARTS").panels, layout.panels);
  const [ui, css] = await Promise.all([
    readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/studio-pro.module.css", import.meta.url), "utf8")
  ]);
  assert.match(ui, /onDragStart=/);
  assert.match(ui, /onDrop=/);
  assert.match(ui, /savePanels\(reorderStudioConsolePanel\(layout, draggedPanelId, id\)\.panels\)/);
  assert.match(css, /\.panelDropTarget\{/);
});

test("presenter cards expose handle-only same-section drag while monitor stays read only", async () => {
  const [ui, css] = await Promise.all([
    readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/studio-pro.module.css", import.meta.url), "utf8")
  ]);
  for (const id of STUDIO_CONSOLE_PANELS) {
    assert.match(ui, new RegExp(`data-panel-id="${id}"`));
    assert.match(ui, new RegExp(`data-card-drag="${id}"`));
  }
  assert.match(ui, /if \(!handle\) return/);
  assert.match(ui, /draggedCard\?\.section !== section/);
  assert.match(ui, /reorderStudioConsolePanel\(data\.layout, draggedCard\.id, id\)/);
  assert.match(ui, /save\("SAVE_LAYOUT", \{ preset: layout\.preset, panels: layout\.panels, sizes: layout\.sizes \}\)/);
  assert.match(ui, /!monitor \? <span className=\{styles\.cardDragHandle\}/);
  assert.doesNotMatch(ui, /<article[^>]*draggable=/);
  assert.match(css, /\.cardDragHandle\{/);
  assert.match(css, /data-drop-panel="ON_AIR"/);
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

test("Radio Clock programme headers do not double-count their items or delay intentional overlaps", async () => {
  const occurrence = {
    itemId: "programme-1", sourceType: "RADIO_CLOCK", sourceId: "clock-1", label: "Morning hour",
    startsAt: new Date("2026-09-17T10:00:00Z"), endsAt: new Date("2026-09-17T11:00:00Z")
  };
  const clock = { status: "PUBLISHED", version: 2, publishedVersion: 2, items: [
    { id: "intro", type: "MUSIC_MODE", label: "Opening", offsetSeconds: 0, durationSeconds: 1860 },
    { id: "finish", type: "MUSIC_MODE", label: "Close", offsetSeconds: 1800, durationSeconds: 1800 }
  ] };
  const entries = studioProgrammeLogEntries(occurrence, clock);
  assert.equal(entries[0].durationMs, 0);
  assert.equal(entries[0].programmeBoundary, true);
  assert.equal(entries.length, 3);
  const unpublishedEdit = studioProgrammeLogEntries(occurrence, { ...clock, version: 3 });
  assert.equal(unpublishedEdit.length, 1);
  assert.equal(unpublishedEdit[0].durationMs, 3_600_000);
  assert.notEqual(entries[0].id, studioProgrammeLogEntries({ ...occurrence, startsAt: new Date("2026-09-17T12:00:00Z") }, clock)[0].id);
  const log = deriveStudioDailyLog({ dayStart: "2026-09-17T00:00:00Z", dayEnd: "2026-09-18T00:00:00Z", scheduled: entries });
  assert.equal(log.planned[1].estimatedStartAt, "2026-09-17T10:00:00.000Z");
  assert.equal(log.planned[2].estimatedStartAt, "2026-09-17T10:30:00.000Z");
  assert.deepEqual(studioClockBoundaryConflicts(log), []);
  const [route, ui] = await Promise.all([
    readFile(new URL("../app/api/studio/console/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /studioProgrammeLogEntries\(occurrence, clock\)/);
  assert.match(ui, /studioClockBoundaryConflicts\(data\?\.dailyLog\)/);
});

test("published timed playlist tracks replace only their matching programme duration and retain crossfades", async () => {
  const startAt = new Date("2026-09-17T10:00:00Z");
  const programme = { id: "programme", sourceType: "MUSIC_MODE", sourceId: "mode-1", label: "Generated hour", startsAt: startAt, durationMs: 3_600_000, hardEvent: true, programmeOccurrenceId: "programme" };
  const unrelated = { ...programme, id: "other", sourceId: "mode-2", programmeOccurrenceId: "other" };
  const playlist = { id: "playlist-1", musicModeId: "mode-1", publishedVersion: 2, versions: [
    { version: 1, publishedAt: null, items: [] },
    { version: 2, publishedAt: startAt, items: [
      { id: "track-1", track: { artist: "A", title: "First" }, startOffsetSeconds: 0, durationSeconds: 180 },
      { id: "track-2", track: { artist: "B", title: "Second" }, startOffsetSeconds: 178, durationSeconds: 180 }
    ] }
  ] };
  const projection = studioTimedPlaylistLogEntries(playlist, startAt, [programme, unrelated]);
  assert.equal(projection.scheduled[0].durationMs, 0);
  assert.equal(projection.scheduled[0].programmeBoundary, true);
  assert.equal(projection.scheduled[1].durationMs, 3_600_000);
  assert.deepEqual(projection.generated.map((item) => item.programmeOccurrenceId), ["programme", "programme"]);
  const log = deriveStudioDailyLog({ scheduled: projection.scheduled, generated: projection.generated, dayStart: "2026-09-17T00:00:00Z", dayEnd: "2026-09-18T00:00:00Z" });
  assert.equal(log.planned.find((item) => item.id === "track-2").estimatedStartAt, "2026-09-17T10:02:58.000Z");
  assert.equal(studioTimedPlaylistLogEntries(playlist, startAt, [unrelated]).scheduled[0].durationMs, 3_600_000);
  assert.equal(studioTimedPlaylistLogEntries({ ...playlist, publishedVersion: 1 }, startAt, [programme]).generated.length, 0);
  const route = await readFile(new URL("../app/api/studio/console/route.js", import.meta.url), "utf8");
  assert.match(route, /localMinuteToUtc\(date, playlist\.startMinute, playlist\.timezone\)/);
  assert.equal(localMinuteToUtc("2026-03-29", 180, "Europe/Malta").toISOString(), "2026-03-29T01:00:00.000Z");
});

test("a regenerated draft leaves the previously published playlist visible but not rights-certified", async () => {
  const publishedAt = new Date("2026-09-17T10:00:00Z");
  const playlist = {
    id: "playlist-1", status: "DRAFT", currentVersion: 3, publishedVersion: 2, publishedAt,
    versions: [
      { version: 3, publishedAt: null, items: [{ id: "draft-track", track: { artist: "Draft", title: "Not live" }, startOffsetSeconds: 0, durationSeconds: 100 }] },
      { version: 2, publishedAt, items: [{ id: "published-track", track: { artist: "Published", title: "Still selected" }, startOffsetSeconds: 0, durationSeconds: 100 }] }
    ]
  };
  const projection = studioTimedPlaylistLogEntries(playlist, publishedAt);
  assert.deepEqual(projection.generated.map((item) => item.id), ["published-track"]);
  const log = deriveStudioDailyLog({ generated: projection.generated, dayStart: "2026-09-17T00:00:00Z", dayEnd: "2026-09-18T00:00:00Z" });
  assert.equal(log.planned[0].rightsReady, null);
  const route = await readFile(new URL("../app/api/studio/console/route.js", import.meta.url), "utf8");
  assert.match(route, /status: \{ in: \["PUBLISHED", "DRAFT"\] \}, publishedVersion: \{ gt: 0 \}, publishedAt: \{ not: null \}/);
  assert.match(route, /timedPlaylists\.push\(\{ id: playlist\.id, name: playlist\.name/);
  const consoleUi = await readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8");
  assert.match(consoleUi, /<TimedPlaylistHandoff playlists=\{data\.dailyLog\?\.timedPlaylists\}/);
  assert.match(consoleUi, /timedPlaylistId=\$\{encodeURIComponent\(playlist\.id\)\}#workspace-automation/);
});

test("a clock item crossing another fixed programme is flagged for planning, not playback proof", () => {
  const first = studioProgrammeLogEntries({
    itemId: "morning", sourceType: "RADIO_CLOCK", sourceId: "clock-1", label: "Morning",
    startsAt: new Date("2026-09-17T10:00:00Z"), endsAt: new Date("2026-09-17T11:00:00Z")
  }, { status: "PUBLISHED", version: 1, publishedVersion: 1, items: [
    { id: "early", type: "MUSIC_MODE", label: "Opening sweep", offsetSeconds: 0, durationSeconds: 3000 },
    { id: "late", type: "MUSIC_MODE", label: "Late sweep", offsetSeconds: 3000, durationSeconds: 600 }
  ] });
  const second = studioProgrammeLogEntries({
    itemId: "midday", sourceType: "MUSIC_MODE", sourceId: "mode-2", label: "Midday",
    startsAt: new Date("2026-09-17T10:55:00Z"), endsAt: new Date("2026-09-17T11:55:00Z")
  });
  const log = deriveStudioDailyLog({ dayStart: "2026-09-17T00:00:00Z", dayEnd: "2026-09-18T00:00:00Z", scheduled: [...first, ...second] });
  const conflicts = studioClockBoundaryConflicts(log);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].clockLabel, "Late sweep");
  assert.equal(conflicts[0].boundaryLabel, "Midday");
  assert.equal(conflicts[0].overlapMs, 300_000);
  assert.equal("actualStartAt" in conflicts[0], false);
  assert.equal(log.actual.length, 0);
  assert.equal(studioProgrammeLogEntries({
    itemId: "plain", sourceType: "MUSIC_MODE", sourceId: "mode-3", label: "Plain",
    startsAt: new Date("2026-09-17T13:00:00Z"), endsAt: new Date("2026-09-17T14:00:00Z")
  })[0].durationMs, 3_600_000);
});

test("Daily Log times use the channel timezone and distinguish the repeated DST hour", async () => {
  assert.equal(formatStudioLogTime("2026-03-29T00:30:00Z", "Europe/Malta"), "01:30:00 GMT+1");
  assert.equal(formatStudioLogTime("2026-03-29T01:30:00Z", "Europe/Malta"), "03:30:00 GMT+2");
  assert.equal(formatStudioLogTime("2026-10-25T00:30:00Z", "Europe/Malta"), "02:30:00 GMT+2");
  assert.equal(formatStudioLogTime("2026-10-25T01:30:00Z", "Europe/Malta"), "02:30:00 GMT+1");
  assert.equal(formatStudioLogTime("not-a-date", "Europe/Malta"), "—");
  assert.equal(formatStudioLogTime(null, "Europe/Malta"), "—");
  assert.equal(formatStudioLogTime("2026-10-25T01:30:00Z", "Invalid/Zone"), "—");
  const ui = await readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8");
  assert.match(ui, /formatStudioLogTime\(value, data\?\.dailyLog\?\.timezone\)/);
  assert.match(ui, /clock\(entry\.plannedStartAt\)/);
  assert.match(ui, /clock\(entry\.estimatedStartAt\)/);
});

test("commercial spot board exposes scoped approval records without inventing readiness or play proof", async () => {
  const board = studioSpotBoard({ policy: { status: "ACTIVE" }, orders: [{
    id: "booking-1", name: "Morning booking", status: "APPROVED",
    advertiser: { name: "Sponsor" }, inventoryPackage: { status: "ACTIVE" },
    campaign: { name: "Morning spots", status: "PUBLISHED", promoVersionId: "creative-2", effectiveFrom: new Date("2026-09-20"), effectiveTo: new Date("2026-09-30") },
    creatives: [{ promoVersionId: "creative-1", status: "APPROVED" }, { promoVersionId: "creative-2", status: "PENDING" }]
  }] });
  assert.equal(board.policyStatus, "ACTIVE");
  assert.deepEqual(board.bookings.map((item) => [item.advertiser, item.bookingStatus, item.campaignStatus, item.inventoryStatus, item.creativeStatus]),
    [["Sponsor", "APPROVED", "PUBLISHED", "ACTIVE", "PENDING"]]);
  assert.equal(Object.hasOwn(board.bookings[0], "ready"), false);
  assert.equal(Object.hasOwn(board.bookings[0], "deliveredPlays"), false);
  assert.deepEqual(studioSpotBoard(), { policyStatus: "NOT_CONFIGURED", bookings: [] });
  const [route, ui] = await Promise.all([
    readFile(new URL("../app/api/studio/console/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /planProductFamily === "ONLINE" && access\.entitlements\.onlineRadioEnabled && access\.entitlements\.retailMediaEnabled/);
  assert.match(route, /where: \{ organisationId, campaign: \{ targets: \{ some: \{ OR: targetScopes \} \} \} \}/);
  assert.match(route, /targetType: "CHANNEL", channelId: channel\.id/);
  assert.match(route, /targetType: "STATION", stationId: channel\.stationId/);
  assert.match(ui, /!monitor && data\.spotBoard/);
  assert.match(ui, /not a timed playout list or proof that an advert reached listeners/);
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
  assert.match(consoleUi, /Untimed future Manual queue/);
  assert.match(consoleUi, /prepareQueue\("REPLACE_FUTURE"/);
  assert.match(consoleUi, /prepareQueue\("LOCK"/);
  assert.match(consoleUi, /prepareQueue\("SEND_NEXT"/);
  assert.match(consoleUi, /hardEventTiming\?\.deltaMs < 0/);
  assert.match(playout, /planStudioFutureReorder\(session\.items, input\.itemId, input\.position\)/);
  assert.match(playout, /planStudioFutureReplacement\(session\.items, input\.itemId, input\.replacementItemId\)/);
  assert.match(playout, /outgoingAsset\?\.mediaType !== "MUSIC"/);
});
