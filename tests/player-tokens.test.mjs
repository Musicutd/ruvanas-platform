import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlayerToken,
  effectivePlayerStatus,
  hashPlayerToken
} from "../lib/player-tokens.mjs";

const secret = "test-secret-that-is-longer-than-thirty-two-characters";

test("player tokens are opaque, unique, and hashed deterministically", () => {
  const first = createPlayerToken();
  const second = createPlayerToken();

  assert.notEqual(first, second);
  assert.ok(first.length >= 40);
  assert.equal(hashPlayerToken(first, secret), hashPlayerToken(first, secret));
  assert.notEqual(hashPlayerToken(first, secret), first);
});

test("effective player health derives offline state from heartbeat age", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");

  assert.equal(effectivePlayerStatus({ status: "PENDING_ENROLMENT" }, now), "PENDING_ENROLMENT");
  assert.equal(
    effectivePlayerStatus({
      status: "ONLINE",
      enrolledAt: new Date("2026-08-25T11:00:00.000Z"),
      lastHeartbeatAt: new Date("2026-08-25T11:59:31.000Z")
    }, now),
    "ONLINE"
  );
  assert.equal(
    effectivePlayerStatus({
      status: "ONLINE",
      enrolledAt: new Date("2026-08-25T11:00:00.000Z"),
      lastHeartbeatAt: new Date("2026-08-25T11:58:00.000Z")
    }, now),
    "OFFLINE"
  );
  assert.equal(effectivePlayerStatus({ status: "DISABLED" }, now), "DISABLED");
});

