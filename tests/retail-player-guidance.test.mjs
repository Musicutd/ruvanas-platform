import assert from "node:assert/strict";
import test from "node:test";
import { retailPlayerGuidance, retailPlayerStatusLabel } from "../lib/retail-player-guidance.mjs";

test("shop setup presents only the next prerequisite and respects view-only access", () => {
  assert.equal(retailPlayerGuidance({ canManage: true }).kind, "ADD_SHOP");
  assert.equal(retailPlayerGuidance({ canManage: true, hasZones: true }).kind, "CREATE_PLAYER");
  assert.equal(retailPlayerGuidance({ canManage: false, hasZones: true }).kind, "VIEW_ONLY");
  assert.equal(retailPlayerGuidance({ canManage: true, hasZones: true, setupAccessEnabled: false }).kind, "ACCESS_REQUIRED");
});

test("partial or absent device evidence cannot be described as ready", () => {
  for (const readiness of [undefined, {}, { code: "WAITING_FOR_PLAYBACK", ready: false }, { code: "OFFLINE", ready: false }]) {
    assert.equal(retailPlayerGuidance({ players: [{ id: "one", status: "ONLINE", readiness }] }).kind, "CHECK_PLAYER");
  }
  const ready = { id: "ready", status: "ONLINE", readiness: { code: "READY", ready: true } };
  const pending = { id: "pending", status: "ONLINE", readiness: { code: "CHANNEL_REQUIRED", ready: false } };
  assert.equal(retailPlayerGuidance({ players: [ready, pending] }).playerId, "pending");
  assert.equal(retailPlayerGuidance({ players: [ready] }).kind, "READY");
});

test("retired players are never used to assert current playback", () => {
  assert.equal(retailPlayerGuidance({ canManage: true, hasZones: true, players: [{ status: "DISABLED", readiness: { ready: true } }] }).kind, "CREATE_PLAYER");
  assert.equal(retailPlayerStatusLabel({ code: "DISABLED" }), "Retired");
  assert.equal(retailPlayerStatusLabel({ code: "UNKNOWN" }), "Status not confirmed");
});

test("stream progress is described as a device report, not individual song proof", () => {
  const readiness = { code: "STREAM_PLAYING", ready: true, playbackEvidence: "DEVICE_REPORTED_STREAM_ONLY" };
  assert.equal(retailPlayerStatusLabel(readiness), "Stream playing reported");
  const guidance = retailPlayerGuidance({ players: [{ status: "ONLINE", readiness }] });
  assert.match(guidance.title, /report playback/); assert.match(guidance.detail, /do not verify individual song delivery/);
  assert.doesNotMatch(guidance.detail, /playback is confirmed/);
});
