import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { advanceTimedPreemptionRehearsal, startTimedPreemptionRehearsal } from "../lib/studio-timed-preemption-rehearsal.mjs";

const at = (milliseconds) => new Date(Date.UTC(2026, 9, 2, 10, 0, 0, milliseconds));
const green = () => ({ consistent: true, reason: "SEQUENCE_CONTINUATION_CONSISTENT_NOT_ON_AIR",
  sourceCommandAllowed: false, listenerVerified: false });
const denied = (reason) => ({ consistent: false, reason, sourceCommandAllowed: false, listenerVerified: false });

test("a rights withdrawal latches a required halt and a later green check cannot rearm it", () => {
  const first = advanceTimedPreemptionRehearsal(startTimedPreemptionRehearsal(), { continuation: green(), instant: at(0) });
  assert.equal(first.response, "CONTINUE_REHEARSAL_ONLY");
  const second = advanceTimedPreemptionRehearsal(first.state, { continuation: green(), instant: at(500) });
  assert.equal(second.response, "CONTINUE_REHEARSAL_ONLY");
  const withdrawn = advanceTimedPreemptionRehearsal(second.state, {
    continuation: denied("SEQUENCE_RIGHTS_USE_NOT_PERMITTED"), instant: at(900)
  });
  assert.equal(withdrawn.response, "HALT_REQUIRED_NOT_EXECUTED");
  assert.equal(withdrawn.reason, "SEQUENCE_RIGHTS_USE_NOT_PERMITTED");
  assert.equal(withdrawn.commandIssued, false);
  assert.equal(withdrawn.listenerVerified, false);
  const later = advanceTimedPreemptionRehearsal(withdrawn.state, { continuation: green(), instant: at(950) });
  assert.equal(later.response, "HALT_LATCHED");
  assert.equal(later.reason, withdrawn.reason);
  assert.equal(later.state, withdrawn.state);
});

test("competing source, lost lease and stale evidence each require an unexecuted halt", () => {
  for (const reason of ["CAMPAIGN_OUTPUT_NOT_COMPILED", "SEQUENCE_CONTINUATION_COMPETING_SOURCE_NOT_ARBITRATED",
    "SEQUENCE_CONTINUATION_ENCODER_LEASE_UNAVAILABLE", "SEQUENCE_CONTINUATION_SNAPSHOT_STALE"]) {
    const result = advanceTimedPreemptionRehearsal(startTimedPreemptionRehearsal(), {
      continuation: denied(reason), instant: at(0)
    });
    assert.equal(result.response, "HALT_REQUIRED_NOT_EXECUTED");
    assert.equal(result.reason, reason);
    assert.equal(result.sourceCommandAllowed, false);
  }
});

test("missed, reversed or untrusted checks fail closed", () => {
  const first = advanceTimedPreemptionRehearsal(startTimedPreemptionRehearsal(), { continuation: green(), instant: at(0) });
  assert.equal(advanceTimedPreemptionRehearsal(first.state, { continuation: green(), instant: at(1000) }).reason,
    "SEQUENCE_REHEARSAL_RECHECK_MISSED");
  assert.equal(advanceTimedPreemptionRehearsal(first.state, { continuation: green(), instant: at(0) }).reason,
    "SEQUENCE_REHEARSAL_RECHECK_MISSED");
  assert.equal(advanceTimedPreemptionRehearsal(first.state, { continuation: green(), instant: null }).reason,
    "SEQUENCE_REHEARSAL_CLOCK_INVALID");
  assert.equal(advanceTimedPreemptionRehearsal(first.state, {
    continuation: { ...green(), sourceCommandAllowed: true }, instant: at(500)
  }).reason, "SEQUENCE_REHEARSAL_DIAGNOSTIC_UNTRUSTED");
  assert.equal(advanceTimedPreemptionRehearsal(first.state, {
    continuation: denied("unexpected secret or log content"), instant: at(500)
  }).reason, "SEQUENCE_CONTINUATION_UNAVAILABLE");
});

test("the preemption rehearsal cannot affect the live encoder worker", async () => {
  const [rehearsal, worker] = await Promise.all([
    readFile(new URL("../lib/studio-timed-preemption-rehearsal.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(rehearsal, /createConnection|\.connect\(|fetch\(|PrismaClient|DATABASE_URL|sourcePasswordEncrypted|output\.shoutcast/);
  assert.doesNotMatch(worker, /studio-timed-preemption-rehearsal|advanceTimedPreemptionRehearsal/);
});
