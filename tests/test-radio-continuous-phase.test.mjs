import test from "node:test";
import assert from "node:assert/strict";
import { continuousObservedPhase, continuousPhaseView } from "../lib/test-radio-continuous-phase.mjs";

const evidence = { phase: "SCHEDULED", occurrenceId: "occurrence-1", scheduleRevision: "approved-revision-1", trackId: "track-1" };
const schedule = { enabled: true, revisionFingerprint: "approved-revision-1", occurrences: [{ id: "occurrence-1", label: "Morning mix",
  startsAt: "2026-10-23T08:00:00Z", endsAt: "2026-10-23T09:00:00Z", tracks: [{ trackId: "track-1" }] }] };
test("scheduled source evidence matches the approved revision and track, not caller-supplied labels", () => {
  const result = continuousObservedPhase({ ...evidence, programmeLabel: "Untrusted caller label" }, schedule);
  assert.equal(result.phase, "SCHEDULED"); assert.equal(result.programme.label, "Morning mix");
  assert.equal(result.programme.startsAt, "2026-10-23T08:00:00.000Z");
  assert.equal(continuousPhaseView(result).label, "Scheduled programme: Morning mix");
});
test("disabled, changed or unmatched schedule degrades the phase without granting or stopping audio", () => {
  for (const change of [{ phase: "CLOCK_GUESS" }, { occurrenceId: "other" }, { scheduleRevision: "old" }, { trackId: "other" }]) {
    assert.deepEqual(continuousObservedPhase({ ...evidence, ...change }, schedule), { phase: "UNKNOWN", programme: null });
  }
  for (const value of [null, { ...schedule, enabled: false }, { ...schedule, revisionFingerprint: "replacement" }]) {
    assert.equal(continuousObservedPhase(evidence, value).phase, "UNKNOWN");
  }
  assert.deepEqual(continuousObservedPhase({ phase: "RANDOM" }, null), { phase: "RANDOM", programme: null });
});
test("phase presentation copies only bounded public fields and rejects malformed programme intervals", () => {
  const value = continuousObservedPhase(evidence, schedule);
  value.programme.secret = "DO_NOT_EXPOSE";
  value.programme.label = "A\u0000\nB" + "x".repeat(500);
  const result = continuousPhaseView(value);
  assert.equal(result.programme.label.length, 160); assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EXPOSE|\\u0000/);
  value.programme.endsAt = value.programme.startsAt;
  assert.equal(continuousPhaseView(value).phase, "UNKNOWN");
  assert.equal(continuousPhaseView(null).phase, "UNKNOWN");
});
