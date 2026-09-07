import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createListenerRequestDedupeKey,
  listenerRequestTransition,
  normalizeListenerRequest,
  normalizeListenerRequestSettings,
  safeListenerRequest
} from "../lib/listener-interaction.mjs";

const secret = "stage-19-15-listener-interaction-test-secret";
const instant = new Date("2026-09-06T12:00:00.000Z");

test("listener request input is bounded and rejects contact links", () => {
  assert.deepEqual(normalizeListenerRequest({ artist: "  Artist  ", title: " My Song ", message: "Please play this" }), { artist: "Artist", title: "My Song", message: "Please play this" });
  assert.throws(() => normalizeListenerRequest({ artist: "Artist", title: "https://example.com" }), /links or contact/);
  assert.throws(() => normalizeListenerRequest({ artist: "", title: "Song" }), /Artist/);
  assert.throws(() => normalizeListenerRequest({ artist: "Artist", title: "Song", message: "x".repeat(241) }), /240/);
  assert.deepEqual(normalizeListenerRequestSettings({ enabled: true, instructions: " Requests are reviewed. " }), { enabled: true, instructions: "Requests are reviewed." });
});

test("deduplication is private, station scoped and rotates after the policy window", () => {
  const input = { stationId: "station-1", sessionHash: "a".repeat(64), artist: "Artist", title: "Song", instant, secret };
  const first = createListenerRequestDedupeKey(input);
  assert.equal(first.length, 64);
  assert.equal(first, createListenerRequestDedupeKey({ ...input, artist: "artist", title: "song" }));
  assert.notEqual(first, createListenerRequestDedupeKey({ ...input, stationId: "station-2" }));
  assert.notEqual(first, createListenerRequestDedupeKey({ ...input, instant: new Date(instant.getTime() + 31 * 60_000) }));
  assert.doesNotMatch(first, /station-1|artist|song/i);
});

test("moderation transitions are explicit and cannot enqueue playout", () => {
  assert.deepEqual(listenerRequestTransition("PENDING", "APPROVE"), { status: "APPROVED", reviewNote: null });
  assert.deepEqual(listenerRequestTransition("PENDING", "REJECT", "Not suitable"), { status: "REJECTED", reviewNote: "Not suitable" });
  assert.equal(listenerRequestTransition("APPROVED", "MARK_PLAYED").status, "PLAYED");
  assert.equal(listenerRequestTransition("PLAYED", "ARCHIVE").status, "ARCHIVED");
  assert.throws(() => listenerRequestTransition("PENDING", "REJECT", ""), /short reason/);
  assert.throws(() => listenerRequestTransition("PENDING", "MARK_PLAYED"), /cannot/);
});

test("listener-facing records never expose anonymous session hashes", () => {
  const safe = safeListenerRequest({ id: "request-1", artist: "Artist", title: "Song", message: null, status: "PENDING", sessionHash: "private", dedupeKey: "private", reviewNote: null, reviewedAt: null, createdAt: instant, updatedAt: instant }, false);
  assert.equal(safe.id, "request-1");
  assert.equal("sessionHash" in safe, false);
  assert.equal("dedupeKey" in safe, false);
});

test("Stage 19.15 routes require a live listener lease, tenant moderation and abuse controls", async () => {
  const [publicRoute, queueRoute, actionRoute, player, migration] = await Promise.all([
    readFile(new URL("../app/api/public/player/[slug]/requests/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/listener-requests/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/listener-requests/[requestId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PublicRadioPlayer.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261016000000_stage_19_15_listener_interaction/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(publicRoute, /publicListenerLease\.findUnique/);
  assert.match(publicRoute, /listenerRequestBlock\.findUnique/);
  assert.match(publicRoute, /consumeRateLimit/);
  assert.match(publicRoute, /enqueueNotificationEvent/);
  assert.match(queueRoute, /requireOrganisationProductAccess/);
  assert.match(queueRoute, /"ONLINE"/);
  assert.match(actionRoute, /updateMany/);
  assert.match(actionRoute, /LISTENER_REQUEST_SESSION_UNBLOCKED/);
  assert.match(player, /Requests are moderated and are not guaranteed to play/);
  assert.doesNotMatch(publicRoute, /playoutIntent|programmeScheduleItem|musicSchedule\.create/i);
  assert.match(migration, /ListenerRequest_stationId_dedupeKey_key/);
  assert.match(migration, /ListenerRequest_stationId_status_createdAt_idx/);
});

test("request normalization remains bounded under burst input", () => {
  const started = performance.now();
  for (let index = 0; index < 20_000; index += 1) normalizeListenerRequest({ artist: `Artist ${index}`, title: `Song ${index}`, message: "Please consider this song." });
  assert.ok(performance.now() - started < 1_500);
});
