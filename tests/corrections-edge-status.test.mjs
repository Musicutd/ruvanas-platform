import assert from "node:assert/strict";
import test from "node:test";
import { correctionsEdgeEffectiveStatus } from "../lib/corrections-edge-status.mjs";

test("Edge health never treats an old sync or mere heartbeat as healthy", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  const node = { status: "ACTIVE", lastSeenAt: new Date(now.getTime() - 30_000),
    lastSuccessfulSyncAt: null, syncStatus: "IDLE", storageHealth: "HEALTHY" };
  assert.equal(correctionsEdgeEffectiveStatus(node, now), "DEGRADED");
  assert.equal(correctionsEdgeEffectiveStatus({ ...node, lastSuccessfulSyncAt: new Date(now.getTime() - 11 * 60_000) }, now), "DEGRADED");
  assert.equal(correctionsEdgeEffectiveStatus({ ...node, lastSuccessfulSyncAt: new Date(now.getTime() - 30_000) }, now), "ONLINE");
  assert.equal(correctionsEdgeEffectiveStatus({ ...node, lastSeenAt: new Date(now.getTime() - 91_000) }, now), "OFFLINE");
  assert.equal(correctionsEdgeEffectiveStatus({ ...node, status: "REVOKED" }, now), "REVOKED");
});
