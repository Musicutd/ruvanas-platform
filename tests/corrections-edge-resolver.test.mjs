import assert from "node:assert/strict";
import test from "node:test";
import { resolveCorrectionsEdgePlayback } from "../edge/resolver.mjs";
import { edgeContentKey } from "../edge/cache.mjs";

const now = new Date("2026-09-27T12:00:00.000Z");
const item = (id) => ({ mediaAssetId: id, promoVersionId: `v-${id}`, sha256: "a".repeat(64),
  sizeBytes: 12, mimeType: "audio/wav", rightsUse: "CORRECTIONS_RADIO" });
const content = [item("mandatory"), item("local"), item("central"), item("fallback"), item("priority"), item("emergency")];
const windows = [
  { id: "fallback", facilityId: "facilityA", kind: "FALLBACK", mandatory: false, distributionId: "d-fallback", weekday: 0,
    startMinute: 0, endMinute: 1440, contentKey: edgeContentKey(content[3]) },
  { id: "central", facilityId: "facilityA", kind: "CENTRAL", mandatory: false, distributionId: "d-central", weekday: 0,
    startMinute: 0, endMinute: 1440, contentKey: edgeContentKey(content[2]) },
  { id: "local", facilityId: "facilityA", kind: "LOCAL", mandatory: false, distributionId: "d-local", weekday: 0,
    startMinute: 0, endMinute: 1440, contentKey: edgeContentKey(content[1]) },
  { id: "mandatory", facilityId: "facilityA", kind: "CENTRAL", mandatory: true, distributionId: "d-mandatory", weekday: 0,
    startMinute: 0, endMinute: 1440, contentKey: edgeContentKey(content[0]) }
];
const base = { schema: 1, nodeId: "nodeA", organisationId: "orgA", facilityId: "facilityA", timezone: "UTC",
  issuedAt: new Date(now.getTime() - 1000).toISOString(), validUntil: new Date(now.getTime() + 60_000).toISOString(),
  zones: [{ id: "zoneA", channelId: "channelA", playerIds: ["playerA"] }], windows, overrides: [], content };
const resolve = (payload, options = {}) => resolveCorrectionsEdgePlayback(payload, { zoneId: "zoneA", playerId: "playerA", instant: now, ...options });

test("Edge uses shared C7 mandatory > local > central > private fallback ordering", () => {
  assert.equal(resolve(base).windowId, "mandatory");
  assert.equal(resolve({ ...base, windows: windows.filter((item) => item.id !== "mandatory") }).windowId, "local");
  assert.equal(resolve({ ...base, windows: windows.filter((item) => !["mandatory", "local"].includes(item.id)) }).windowId, "central");
  assert.equal(resolve({ ...base, windows: windows.filter((item) => item.id === "fallback") }).source, "CORRECTIONS_FALLBACK");
  assert.equal(resolve(base, { unavailableContentKeys: new Set([edgeContentKey(content[0])]) }).windowId, "local");
  assert.equal(resolve(base, { playerId: "playerB" }).state, "PLAYER_NOT_AUTHORISED");
  assert.equal(resolve(base, { instant: new Date(now.getTime() + 60_000) }).state, "EXPIRED_OR_UNAVAILABLE");
});

test("already-received C6 Emergency outranks Priority; expiry returns to current C7 source", () => {
  const override = (type, contentIndex) => ({ id: type, type, facilityId: "facilityA", targetZoneIds: ["zoneA"],
    targetPlayerIds: ["playerA"], contentKey: edgeContentKey(content[contentIndex]),
    startedAt: new Date(now.getTime() - 1000).toISOString(), expiresAt: new Date(now.getTime() + 20_000).toISOString() });
  const payload = { ...base, overrides: [override("PRIORITY", 4), override("EMERGENCY", 5)] };
  assert.equal(resolve(payload).source, "CORRECTIONS_EMERGENCY");
  assert.equal(resolve({ ...payload, overrides: [override("PRIORITY", 4)] }).source, "CORRECTIONS_PRIORITY");
  assert.equal(resolve(payload, { unavailableContentKeys: new Set([edgeContentKey(content[5])]) }).state,
    "OVERRIDE_MEDIA_UNAVAILABLE");
  assert.equal(resolve(payload, { instant: new Date(now.getTime() + 30_000) }).windowId, "mandatory");
});
