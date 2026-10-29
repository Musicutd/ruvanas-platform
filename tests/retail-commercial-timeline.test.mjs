import test from "node:test";
import assert from "node:assert/strict";
import { createRetailCommercialTimeline } from "../lib/retail-commercial-timeline.mjs";

const RATE = 48000, REV = "a".repeat(64), FP = "b".repeat(64), FP2 = "c".repeat(64);
const random = { phase: "RANDOM", nextBoundaryAtMs: null };
const rule = overrides => ({ name: "Shop message", mode: "EVERY_SONGS", spotIds: ["promo-1"], weekdays: [0, 1, 2, 3, 4, 5, 6], everySongs: 3, ...overrides });
const timed = overrides => rule({ mode: "SCHEDULED", times: ["10:00"], ...overrides });
function fixture(rules = [rule()], initial = "2026-10-29T08:59:50Z", options = {}) {
  let time = Date.parse(initial);
  const controller = createRetailCommercialTimeline({ now: () => time });
  const snapshot = { enabled: true, revisionFingerprint: REV, timezone: "Europe/Malta", effectiveAt: new Date(time - 1000).toISOString(),
    rules, spots: [{ id: "promo-1", name: "Offer", fingerprint: FP, track: { id: "promo-1", mediaAssetId: "media-1" } },
      { id: "promo-2", name: "Second", fingerprint: FP2, track: { id: "promo-2", mediaAsset: { id: "media-2" } } }], ...options.snapshot };
  let frames = new Map([[FP, 5 * RATE], [FP2, 7 * RATE]]);
  function refresh() { controller.update({ ...snapshot, validUntil: new Date(time + 15000).toISOString() }, frames); }
  refresh();
  return { controller, snapshot, time: () => time, frames: value => { frames = value; refresh(); },
    advance(ms, refreshing = true) { if (refreshing) { while (ms > 10000) { time += 10000; ms -= 10000; refresh(); } } time += ms; if (refreshing) refresh(); },
    refresh, at: (offset, music = random) => controller.planAt(time + offset, music),
    start(id = "song", length = 5000, extra = {}) { controller.musicStarted({ trackId: id, atMs: time, expectedEndAtMs: time + length, phase: "RANDOM", contentKind: "MUSIC", ...extra }); },
    finish(id = "song", extra = {}) { controller.musicFinished({ trackId: id, atMs: time, phase: "RANDOM", contentKind: "MUSIC", ...extra }); } };
}

test("every three completed music songs produces one ordered break, never counting spots", () => {
  const f = fixture([rule({ spotIds: ["promo-1", "promo-2"] })]);
  for (let i = 1; i <= 2; i++) { f.start(`song-${i}`); f.advance(5000); f.finish(`song-${i}`); assert.equal(f.at(0).phase, "RANDOM"); }
  f.start("song-3");
  const warmed = f.at(5000);
  assert.equal(warmed.contentKind, "COMMERCIAL"); assert.equal(warmed.afterMusic, true); assert.equal(warmed.offsetFrames, 0);
  assert.equal(f.at(0).nextBoundaryAtMs, f.time() + 5000);
  f.advance(5000); f.finish("song-3");
  assert.equal(f.at(0).key, warmed.key); assert.equal(f.at(0).trackId, "promo-1");
  f.start("promo-1", 5000, { contentKind: "COMMERCIAL" });
  f.advance(5000); f.finish("promo-1", { contentKind: "COMMERCIAL" });
  assert.equal(f.at(0).trackId, "promo-2"); assert.equal(f.at(0).offsetFrames, 0);
  f.advance(7000); assert.equal(f.at(0).phase, "RANDOM");
  f.start("song-4"); f.advance(5000); f.finish("song-4"); assert.equal(f.at(0).phase, "RANDOM");
});

test("predicted frequency warmup is stable across a corrected actual EOF", () => {
  const f = fixture([rule({ everySongs: 1 })]);
  f.start("longer-song", 5000);
  const warm = f.at(5000);
  assert.equal(f.at(6000).offsetFrames, 0, "prediction must not seek before the music actually ends");
  f.advance(5500); f.finish("longer-song");
  assert.equal(f.at(0).key, warm.key); assert.equal(f.at(0).offsetFrames, 0);
  assert.equal(f.at(0).occurrenceStartsAtMs, f.time());
  f.advance(1000); assert.equal(f.at(0).offsetFrames, RATE);
});

test("lookahead never consumes a break and duplicate EOF does not count twice", () => {
  const f = fixture([rule({ everySongs: 2 })]);
  f.start("one"); f.advance(5000); f.finish("one"); f.finish("one");
  assert.equal(f.at(0).phase, "RANDOM");
  f.start("two"); const key = f.at(5000).key;
  for (let n = 0; n < 30; n++) assert.equal(f.at(5000).key, key);
  f.advance(5000); f.finish("two"); assert.equal(f.at(0).key, key);
});

test("interrupted and partial scheduled music cannot advance a song-count break", () => {
  const f = fixture([rule({ everySongs: 2 })]);
  f.start("interrupted"); f.advance(2000); f.start("replacement"); f.advance(5000); f.finish("replacement");
  assert.equal(f.at(0).phase, "RANDOM");
  f.start("partial", 5000, { phase: "SCHEDULED", offsetFrames: RATE }); f.advance(5000); f.finish("partial");
  assert.equal(f.at(0).phase, "RANDOM");
  f.start("full", 5000, { phase: "SCHEDULED", offsetFrames: 0 }); f.advance(5000); f.finish("full");
  assert.equal(f.at(0).contentKind, "COMMERCIAL");
});

test("minute frequency waits for the music EOF rather than interrupting at the due minute", () => {
  const f = fixture([rule({ mode: "EVERY_MINUTES", everyMinutes: 1 })]);
  f.start("seventy-seconds", 70000);
  const warmed = f.at(70000);
  assert.equal(warmed.afterMusic, true);
  f.advance(60000); assert.equal(f.at(0).phase, "RANDOM");
  f.advance(10000); f.finish("seventy-seconds"); assert.equal(f.at(0).key, warmed.key);
  f.advance(5000); f.start("next", 10000); f.advance(10000); f.finish("next");
  assert.equal(f.at(0).phase, "RANDOM");
});

test("half-hour and top-of-hour rules use Malta time and only selected weekdays", () => {
  const f = fixture([timed({ times: ["10:00", "10:30"], weekdays: [4] })]);
  assert.equal(f.at(0).nextBoundaryAtMs, Date.parse("2026-10-29T09:00:00Z"));
  f.advance(10000); assert.equal(f.at(0).contentKind, "COMMERCIAL");
  f.advance(5000); assert.equal(f.at(0).phase, "RANDOM");
  assert.equal(f.at(0).nextBoundaryAtMs, Date.parse("2026-10-29T09:30:00Z"));
  const other = fixture([rule({ mode: "TOP_OF_HOUR", hours: [10], weekdays: [5] })]);
  assert.equal(other.at(10000).phase, "RANDOM");
  const hourly = fixture([rule({ mode: "TOP_OF_HOUR", hours: [10] })]);
  assert.equal(hourly.at(10000).contentKind, "COMMERCIAL");
});

test("startup after a timed slot skips the missed break without catch-up", () => {
  const f = fixture([timed()], "2026-10-29T09:00:00.001Z");
  assert.equal(f.at(0).phase, "RANDOM"); assert.equal(f.at(2000).phase, "RANDOM");
});

test("new approval does not join an already elapsed timed break", () => {
  const f = fixture([timed()]);
  f.advance(10000); assert.equal(f.at(0).contentKind, "COMMERCIAL");
  f.advance(1000); f.snapshot.revisionFingerprint = "d".repeat(64); f.refresh();
  assert.equal(f.at(0).phase, "RANDOM");
});

test("stale approval drops only commercials; refresh does not rejoin the expired break", () => {
  const f = fixture([timed()]);
  f.frames(new Map([[FP, 60 * RATE], [FP2, RATE]]));
  f.advance(10000); assert.equal(f.at(0).contentKind, "COMMERCIAL");
  f.advance(15001, false);
  const programme = { phase: "SCHEDULED", key: "music", trackId: "music", nextBoundaryAtMs: 123 };
  assert.equal(f.at(0, programme), programme);
  f.refresh(); assert.equal(f.at(0).phase, "RANDOM");
});

test("programme start and end outrank commercials, including an exact shared boundary", () => {
  const f = fixture([timed()]);
  const start = Date.parse("2026-10-29T09:00:00Z");
  assert.equal(f.at(10000, { ...random, previousProgrammeBoundaryAtMs: start }).phase, "RANDOM");
  assert.equal(f.at(10000, { phase: "SCHEDULED", key: "programme", occurrenceStartsAtMs: start }).key, "programme");
  assert.equal(f.at(10000, { ...random, nextProgrammeBoundaryAtMs: start + 2000 }).phase, "RANDOM");
  assert.equal(f.at(10000, { ...random, nextProgrammeBoundaryAtMs: start + 5000 }).contentKind, "COMMERCIAL", "ending exactly at a programme start is safe");
  assert.equal(f.at(12000, { ...random, previousProgrammeBoundaryAtMs: start + 1000 }).phase, "RANDOM");
});

test("ordinary scheduled track or refresh boundaries do not truncate a commercial", () => {
  const f = fixture([timed()]);
  const start = Date.parse("2026-10-29T09:00:00Z");
  const plan = f.at(10000, { phase: "SCHEDULED", key: "music", occurrenceStartsAtMs: start - 60000,
    nextBoundaryAtMs: start + 1000, nextProgrammeBoundaryAtMs: start + 1800000 });
  assert.equal(plan.contentKind, "COMMERCIAL"); assert.equal(plan.nextBoundaryAtMs, start + 5000);
});

test("timed collisions use approved order without a backlog", () => {
  const f = fixture([timed({ name: "First" }), timed({ name: "Second", spotIds: ["promo-2"] })]);
  assert.equal(f.at(10000).ruleName, "First"); assert.equal(f.at(16000).phase, "RANDOM");
  assert.ok(f.controller.warnings().some(item => item.code === "RETAIL_COMMERCIAL_COLLISION_SKIPPED" && item.ruleName === "Second"));
});

test("timed breaks outrank overlapping song-count breaks and skipped frequency slots do not queue", () => {
  const f = fixture([rule({ everySongs: 1 }), timed({ name: "Exact" })]);
  f.start("song", 8000);
  assert.equal(f.at(8000).phase, "RANDOM", "would cross the exact timed break");
  f.advance(8000); f.finish("song"); assert.equal(f.at(0).phase, "RANDOM");
  f.advance(2000); assert.equal(f.at(0).ruleName, "Exact");
  f.advance(5000); assert.equal(f.at(0).phase, "RANDOM");
});

test("frequency collisions play the first rule and reset all collided rules", () => {
  const f = fixture([rule({ everySongs: 2, name: "First" }), rule({ everySongs: 2, name: "Second", spotIds: ["promo-2"] })]);
  for (const id of ["one", "two"]) { f.start(id); f.advance(5000); f.finish(id); }
  assert.equal(f.at(0).ruleName, "First");
  f.advance(5000); f.start("three"); f.advance(5000); f.finish("three"); assert.equal(f.at(0).phase, "RANDOM");
});

test("missing verified PCM lengths skip the whole break, leaving approved music available", () => {
  const f = fixture([timed({ spotIds: ["promo-1", "promo-2"] })]);
  f.frames(new Map([[FP, 5 * RATE]])); assert.equal(f.at(10000).phase, "RANDOM");
  assert.ok(f.controller.warnings().some(item => item.code === "RETAIL_COMMERCIAL_MEDIA_NOT_READY"));
  f.frames(new Map([[FP, 5 * RATE], [FP2, 7 * RATE]])); assert.equal(f.at(10000).trackId, "promo-1");
});

test("refused timed and frequency occurrences fall back once, not repeatedly", () => {
  const f = fixture([timed()]);
  const planned = f.at(10000); f.controller.refuse(planned.occurrenceId);
  assert.equal(f.at(10000).phase, "RANDOM"); f.refresh(); assert.equal(f.at(10000).phase, "RANDOM");
  const g = fixture([rule({ everySongs: 1 })]);
  g.start(); const warm = g.at(5000); g.controller.refuse(warm.occurrenceId);
  g.advance(5000); g.finish(); assert.equal(g.at(0).phase, "RANDOM");
  g.start("next"); g.advance(5000); g.finish("next"); assert.equal(g.at(0).contentKind, "COMMERCIAL");
});

test("campaign dates are inclusive and a break cannot run past its final local day", () => {
  const expired = fixture([timed({ endsOn: "2026-10-28" })]); assert.equal(expired.at(10000).phase, "RANDOM");
  const future = fixture([timed({ startsOn: "2026-10-30" })]); assert.equal(future.at(10000).phase, "RANDOM");
  const current = fixture([timed({ startsOn: "2026-10-29", endsOn: "2026-10-29" })]); assert.equal(current.at(10000).contentKind, "COMMERCIAL");
  const midnight = fixture([rule({ everySongs: 1, endsOn: "2026-10-29" })], "2026-10-29T22:59:50Z");
  midnight.start("last", 8000); midnight.advance(8000); midnight.finish("last"); assert.equal(midnight.at(0).phase, "RANDOM");
});

test("spring clock change skips nonexistent half-hours; autumn repetition plays only once", () => {
  const spring = fixture([timed({ times: ["02:00", "02:30", "03:00"] })], "2026-03-29T00:59:50Z");
  assert.equal(spring.at(10000).contentKind, "COMMERCIAL", "03:00 Malta is 01:00 UTC after the spring transition");
  assert.match(spring.at(10000).occurrenceId, /03:00$/);
  const autumn = fixture([timed({ times: ["02:00", "02:30"] })], "2026-10-25T00:29:50Z");
  assert.match(autumn.at(10000).occurrenceId, /02:30$/);
  autumn.advance(3600000);
  assert.equal(autumn.at(10000).phase, "RANDOM", "second 02:30 must not repeat the commercial");
  const restarted = fixture([timed({ times: ["02:30"] })], "2026-10-25T01:29:50Z");
  assert.equal(restarted.at(10000).phase, "RANDOM", "restart between repeated wall times must not replay the first slot");
});

test("approval changes and disabled snapshots reset frequency state without old events", () => {
  const f = fixture([rule({ everySongs: 2 })]);
  f.start("one"); f.advance(5000); f.finish("one");
  f.snapshot.revisionFingerprint = "d".repeat(64); f.refresh();
  f.start("two"); f.advance(5000); f.finish("two"); assert.equal(f.at(0).phase, "RANDOM");
  f.start("three"); f.advance(5000); f.finish("three"); assert.equal(f.at(0).contentKind, "COMMERCIAL");
  f.controller.update({ enabled: false }, new Map()); assert.equal(f.at(0).phase, "RANDOM");
});

test("malformed or overlong authority fails closed without altering the music plan", () => {
  for (const patch of [{ timezone: "UTC" }, { revisionFingerprint: "no" }, { validUntil: "2099-01-01T00:00:00Z" },
    { effectiveAt: "invalid" }, { spots: [{ id: "promo-1", fingerprint: FP, track: { id: "different", mediaAssetId: "media-1" } }] }]) {
    const f = fixture();
    f.controller.update({ ...f.snapshot, validUntil: new Date(f.time() + 15000).toISOString(), ...patch }, new Map([[FP, RATE]]));
    assert.equal(f.at(0), random); assert.ok(f.controller.warnings().some(row => row.code === "RETAIL_COMMERCIAL_SNAPSHOT_INVALID"));
  }
});

test("decoded frame lengths, not integer catalogue seconds, govern spot transitions", () => {
  const f = fixture([timed({ spotIds: ["promo-1", "promo-2"] })]);
  f.frames(new Map([[FP, RATE * 5 + 1], [FP2, RATE * 7 + 5]]));
  const before = f.at(10000 + 5000); assert.equal(before.trackId, "promo-1"); assert.equal(before.offsetFrames, RATE * 5);
  const exact = f.at(10000 + (RATE * 5 + 1) * 1000 / RATE); assert.equal(exact.trackId, "promo-2"); assert.equal(exact.offsetFrames, 0);
});
