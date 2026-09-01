import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYER_READINESS_PLAYBACK_WINDOW_SECONDS,
  subscriberPlayerReadiness
} from "../lib/subscriber-player-readiness.mjs";

const now = new Date("2026-09-01T18:00:00.000Z");

function player(overrides = {}) {
  return {
    id: "player-1",
    status: "ONLINE",
    enrolledAt: new Date("2026-09-01T17:00:00.000Z"),
    lastHeartbeatAt: new Date("2026-09-01T17:59:40.000Z"),
    zone: {
      channelAssignments: [{ channel: { id: "channel-1", name: "Main shop radio" } }]
    },
    heartbeatSamples: [{
      observedAt: new Date("2026-09-01T17:59:40.000Z"),
      appVersion: "stage-15f-guided-shop-activation",
      manifestVersion: "manifest-8",
      sourceStatus: "CONNECTED"
    }],
    proofOfPlayEvents: [{
      occurredAt: new Date("2026-09-01T17:58:00.000Z"),
      eventType: "STARTED",
      trackTitle: "Opening Track",
      trackArtist: "Ruvanas Artist",
      manifestVersion: "manifest-8"
    }],
    ...overrides
  };
}

test("a configured player waits for its one-time enrolment", () => {
  const readiness = subscriberPlayerReadiness(player({ status: "PENDING_ENROLMENT", enrolledAt: null, lastHeartbeatAt: null, heartbeatSamples: [], proofOfPlayEvents: [] }), now);
  assert.equal(readiness.code, "WAITING_FOR_ENROLMENT");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checklist.find((item) => item.key === "ENROLLED").complete, false);
});

test("an enrolled device waits for its first connection", () => {
  const readiness = subscriberPlayerReadiness(player({ lastHeartbeatAt: null, heartbeatSamples: [], proofOfPlayEvents: [] }), now);
  assert.equal(readiness.code, "WAITING_FOR_CONNECTION");
});

test("an enrolled player reports offline after the existing heartbeat window", () => {
  const readiness = subscriberPlayerReadiness(player({ lastHeartbeatAt: new Date("2026-09-01T17:55:00.000Z") }), now);
  assert.equal(readiness.code, "OFFLINE");
  assert.equal(readiness.level, "ACTION_REQUIRED");
});

test("channel and source problems are distinguished", () => {
  const noChannel = subscriberPlayerReadiness(player({ zone: { channelAssignments: [] } }), now);
  assert.equal(noChannel.code, "CHANNEL_REQUIRED");

  const noDiagnostic = subscriberPlayerReadiness(player({ heartbeatSamples: [{ observedAt: now, sourceStatus: null }] }), now);
  assert.equal(noDiagnostic.code, "WAITING_FOR_SOURCE");
  assert.equal(noDiagnostic.level, "WAITING");

  const degraded = subscriberPlayerReadiness(player({ heartbeatSamples: [{ observedAt: now, sourceStatus: "DEGRADED" }] }), now);
  assert.equal(degraded.code, "SOURCE_ATTENTION");
  assert.match(degraded.summary, /degraded/);
});

test("recent successful playback completes the shop go-live checklist", () => {
  const readiness = subscriberPlayerReadiness(player(), now);
  assert.equal(readiness.code, "READY");
  assert.equal(readiness.ready, true);
  assert.equal(readiness.checklist.every((item) => item.complete), true);
  assert.equal(readiness.latestPlayback.trackTitle, "Opening Track");
  assert.equal(readiness.diagnostics.appVersion, "stage-15f-guided-shop-activation");
});

test("stale or failed playback cannot be presented as ready", () => {
  const staleAt = new Date(now.getTime() - (PLAYER_READINESS_PLAYBACK_WINDOW_SECONDS + 1) * 1000);
  const stale = subscriberPlayerReadiness(player({ proofOfPlayEvents: [{ ...player().proofOfPlayEvents[0], occurredAt: staleAt }] }), now);
  assert.equal(stale.code, "WAITING_FOR_PLAYBACK");
  assert.equal(stale.level, "WAITING");

  const failed = subscriberPlayerReadiness(player({ proofOfPlayEvents: [{ ...player().proofOfPlayEvents[0], eventType: "FAILED" }] }), now);
  assert.equal(failed.code, "WAITING_FOR_PLAYBACK");
  assert.equal(failed.level, "ACTION_REQUIRED");
});

test("retired players remain visibly disabled", () => {
  const readiness = subscriberPlayerReadiness(player({ status: "DISABLED" }), now);
  assert.equal(readiness.code, "DISABLED");
  assert.equal(readiness.level, "RETIRED");
});
