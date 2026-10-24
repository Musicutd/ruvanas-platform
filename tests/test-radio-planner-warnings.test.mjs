import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testRadioPlannerWarnings } from "../lib/test-radio-planner-warnings.mjs";

const NOW = new Date("2026-10-24T04:00:00Z");
const source = (overrides = {}) => ({ id: "dance-pop", name: "Dance & Pop", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["DANCE", "POP"],
  eligibleTrackCount: 20, eligibleDurationSeconds: 7200, readyForSchedule: true, ...overrides });
const item = (overrides = {}) => ({ label: "Saturday Mix", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId: "dance-pop",
  weekday: 6, startTime: "10:00", durationMinutes: 60, priority: 50, ...overrides });
const form = (items = [item()], overrides = {}) => ({ timezone: "Europe/Malta", items, ...overrides });
const check = (draft = form(), sources = [source()], now = NOW) => testRadioPlannerWarnings(draft, sources, { now });
const codes = warnings => warnings.map(warning => warning.code);

test("valid draft guidance describes the 31-day horizon without claiming approval or live audio", () => {
  const warnings = check();
  assert.deepEqual(codes(warnings), ["DRAFT_REVIEW_HORIZON"]);
  assert.match(warnings[0].message, /31-calendar-day/); assert.match(warnings[0].message, /not live audio/);
  assert.match(warnings[0].message, /Only administrator approval/);
});

test("empty, missing and unready playlist warnings identify the actionable row", () => {
  assert.ok(codes(check(form([item({ sourceId: "" })]))).includes("PLAYLIST_REQUIRED"));
  assert.ok(codes(check(form([item({ sourceId: "missing" })]))).includes("PLAYLIST_UNAVAILABLE"));
  for (const [fields, code] of [[{ genreCodes: [] }, "PLAYLIST_GENRES_EMPTY"], [{ eligibleTrackCount: 0, readyForSchedule: false }, "NO_ELIGIBLE_MUSIC"],
    [{ eligibleTrackCount: 65, readyForSchedule: false }, "PLAYLIST_TOO_LARGE"], [{ readyForSchedule: false }, "PLAYLIST_NOT_READY"],
    [{ unavailableGenreCodes: ["POP"], readyForSchedule: false }, "PLAYLIST_GENRE_UNAVAILABLE"]]) {
    const found = check(form(), [source(fields)]).find(warning => warning.code === code);
    assert.equal(found.severity, "BLOCKING"); assert.deepEqual(found.itemIndexes, [0]); assert.match(found.message, /Saturday Mix/);
  }
});

test("small and short unique music pools are advisories rather than invented silence or hard limits", () => {
  const warnings = check(form(), [source({ eligibleTrackCount: 1, eligibleDurationSeconds: 180 })]);
  assert.equal(warnings.some(warning => warning.severity === "BLOCKING"), false);
  assert.ok(codes(warnings).includes("SMALL_MUSIC_POOL"));
  assert.match(warnings.find(warning => warning.code === "MUSIC_MAY_REPEAT").message, /does not mean there will be silence/);
  assert.ok(codes(check(form(), [source({ eligibleDurationSeconds: 3599 })])).includes("MUSIC_MAY_REPEAT"));
  assert.equal(codes(check(form(), [source({ eligibleDurationSeconds: 3600 })])).includes("MUSIC_MAY_REPEAT"), false);
  assert.ok(codes(check(form(), [source({ eligibleTrackCount: undefined, readyForSchedule: undefined })])).includes("MUSIC_READINESS_UNKNOWN"));
});

test("same-priority overlap names both rows and timezone; different priorities name the winner", () => {
  const rows = [item(), item({ label: "Second Mix", startTime: "10:30" })];
  const blocked = check(form(rows)).find(warning => warning.code === "SAME_PRIORITY_OVERLAP");
  assert.equal(blocked.severity, "BLOCKING"); assert.deepEqual(blocked.itemIndexes, [0, 1]);
  assert.match(blocked.message, /Saturday Mix/); assert.match(blocked.message, /Second Mix/); assert.match(blocked.message, /Europe\/Malta/);
  assert.match(blocked.message, /2026-10-24 10:30/);
  const override = check(form([rows[0], { ...rows[1], priority: 60 }])).find(warning => warning.code === "PRIORITY_OVERRIDE");
  assert.equal(override.severity, "WARNING"); assert.match(override.message, /Higher-priority “Second Mix” takes over/);
  assert.equal(codes(check(form([item(), item({ label: "Next hour", startTime: "11:00" })]))).includes("SAME_PRIORITY_OVERLAP"), false);
});

test("overlaps across midnight and one-off conflicts after the first seven days are found", () => {
  const overnight = check(form([item({ startTime: "23:30", durationMinutes: 120 }), item({ label: "Sunday Start", weekday: 0, startTime: "00:30" })]));
  assert.ok(codes(overnight).includes("SAME_PRIORITY_OVERLAP"));
  const later = check(form([item({ weekday: 2 }), item({ label: "Later one-off", recurrence: "ONE_OFF", startsAt: "2026-11-10T10:30" })]));
  assert.match(later.find(warning => warning.code === "SAME_PRIORITY_OVERLAP").message, /2026-11-10 10:30/);
  const outside = check(form([item({ weekday: 2 }), item({ label: "Outside window", recurrence: "ONE_OFF", startsAt: "2026-11-24T10:30" })]));
  assert.equal(codes(outside).includes("SAME_PRIORITY_OVERLAP"), false);
});

test("new ambiguous or skipped one-off times are blocked but saved absolute instants are preserved", () => {
  const ambiguous = item({ recurrence: "ONE_OFF", startsAt: "2026-10-25T02:30" });
  assert.ok(codes(check(form([ambiguous]))).includes("ONE_OFF_AMBIGUOUS_TIME"));
  const saved = { ...ambiguous, originalStartsAt: "2026-10-25T00:30:00Z", originalTimezone: "Europe/Malta" };
  assert.equal(codes(check(form([saved]))).includes("ONE_OFF_AMBIGUOUS_TIME"), false);
  assert.ok(codes(check(form([item({ recurrence: "ONE_OFF", startsAt: "2027-03-28T02:30" })]), [source()], new Date("2027-03-27T12:00:00Z"))).includes("ONE_OFF_CLOCK_GAP"));
});

test("weekly repeated-hour guidance warns without claiming two plays", () => {
  const warnings = check(form([item({ weekday: 0, startTime: "02:30" })]));
  const warning = warnings.find(entry => entry.code === "WEEKLY_REPEATED_TIME");
  assert.equal(warning.severity, "WARNING"); assert.match(warning.message, /do not assume both repeated hours/);
});

test("weekly spring gaps keep later valid occurrences available for overlap checking", () => {
  const warnings = check(form([item({ weekday: 0, startTime: "02:30" }), item({ label: "Following Sunday", recurrence: "ONE_OFF", startsAt: "2027-04-04T03:00" })]),
    [source()], new Date("2027-03-27T12:00:00Z"));
  assert.ok(codes(warnings).includes("WEEKLY_CLOCK_GAP"));
  assert.match(warnings.find(warning => warning.code === "SAME_PRIORITY_OVERLAP").message, /2027-04-04 03:00/);
  assert.equal(codes(warnings).includes("TIMING_REVIEW_INCOMPLETE"), false);
});

test("malformed forms fail safely without hiding valid-row overlaps", () => {
  for (const value of [null, {}, { timezone: "Invalid", items: [] }, { timezone: "Europe/Malta", items: [null] }]) assert.doesNotThrow(() => check(value));
  assert.ok(codes(check(form(), [source()], new Date("invalid"))).includes("REVIEW_TIME_INVALID"));
  assert.ok(codes(check(form([item({ startTime: "25:00" })]))).includes("PROGRAMME_TIMING_INVALID"));
  const warnings = check(form([null, item(), item({ label: "Conflicting valid row", startTime: "10:30" })]));
  assert.deepEqual(warnings.find(warning => warning.code === "SAME_PRIORITY_OVERLAP").itemIndexes, [1, 2]);
});

test("diagnostics are bounded, prioritize blocking issues and do not mutate source or form data", () => {
  const draft = form(Array.from({ length: 200 }, (_, index) => item({ label: `Programme ${index}`, sourceId: index < 40 ? "" : "dance-pop" })));
  const sources = [source({ eligibleTrackCount: 2, eligibleDurationSeconds: 100 })];
  const before = JSON.stringify([draft, sources]);
  const warnings = check(draft, sources);
  assert.ok(warnings.length <= 30); assert.equal(warnings[0].code, "DRAFT_REVIEW_HORIZON");
  assert.equal(warnings.at(-1).code, "MORE_DRAFT_ISSUES");
  assert.equal(JSON.stringify([draft, sources]), before);
  assert.ok(warnings.slice(1, -1).every(warning => warning.severity === "BLOCKING"));
});

test("a full overlapping 200-row draft finishes within a coarse interactive work budget", () => {
  const draft = form(Array.from({ length: 200 }, (_, index) => item({ label: `Programme ${index}` })));
  const started = performance.now(), warnings = check(draft);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5000, `A full draft took ${Math.round(elapsed)} ms; avoid formatting or scanning unbounded conflict pairs.`);
  assert.ok(warnings.length <= 30); assert.equal(warnings.at(-1).code, "MORE_DRAFT_ISSUES");
  assert.ok(warnings.some(warning => warning.code === "SAME_PRIORITY_OVERLAP"));
});

test("helper remains browser-safe and contains no networking, approval or write operation", async () => {
  const code = await readFile(new URL("../lib/test-radio-planner-warnings.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(code, /node:|fetch\s*\(|prisma|\.update\(|\.create\(|localStorage|sessionStorage|approveContinuousSchedule/);
});
