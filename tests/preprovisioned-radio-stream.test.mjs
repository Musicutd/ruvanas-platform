import test from "node:test";
import assert from "node:assert/strict";
import { planPreprovisionedRadioStream } from "../lib/preprovisioned-radio-stream.mjs";

const station = { productFamily: "ONLINE", listenerLimit: 10, maxBitrateKbps: 128 };
const slot = (id, overrides = {}) => ({
  id,
  status: "AVAILABLE",
  providerKey: "CENTOVA_CAST",
  centovaUsername: `station_${id}`,
  streamUrl: `https://station-${id}.example.test/stream`,
  serverHost: "source.example.test",
  serverPort: 8_100 + Number(id),
  sourcePort: 8_100 + Number(id),
  listenerLimit: 10,
  maxBitrateKbps: 128,
  sourcePasswordEncrypted: "encrypted-test-value",
  verifiedAt: "2026-09-19T00:00:00.000Z",
  ...overrides
});

test("plans the smallest verified available slot without exposing its secret", () => {
  const result = planPreprovisionedRadioStream({ station, slots: [slot("1", { maxBitrateKbps: 320 }), slot("2")], occupiedConfigs: [] });
  assert.deepEqual(result, { ready: true, slotId: "2" });
  assert.doesNotMatch(JSON.stringify(result), /encrypted-test-value|source\.example|station-2\.example/);
});

test("never offers a slot whose provider account, listener or source is in use", () => {
  for (const occupied of [
    { centovaUsername: "station_1" },
    { streamUrl: slot("1").streamUrl },
    { serverHost: "SOURCE.EXAMPLE.TEST", sourcePort: 8_101 }
  ]) {
    assert.deepEqual(planPreprovisionedRadioStream({ station, slots: [slot("1")], occupiedConfigs: [occupied] }), { ready: false, reason: "NO_ELIGIBLE_STREAM_SLOT" });
  }
});

test("rejects duplicate or malformed inventory before choosing a slot", () => {
  assert.deepEqual(planPreprovisionedRadioStream({ station, slots: [slot("1"), slot("2", { sourcePort: 8_101 })], occupiedConfigs: [] }), { ready: false, reason: "INVENTORY_CONFLICT" });
  assert.deepEqual(planPreprovisionedRadioStream({ station, slots: [slot("1"), slot("1", { centovaUsername: "different", streamUrl: "https://different.example/stream", sourcePort: 8_102 })], occupiedConfigs: [] }), { ready: false, reason: "INVENTORY_CONFLICT" });
  assert.deepEqual(planPreprovisionedRadioStream({ station, slots: [slot("1")] }), { ready: false, reason: "INVALID_INVENTORY" });
  for (const override of [
    { sourcePasswordEncrypted: "" },
    { verifiedAt: null },
    { serverHost: "localhost" },
    { serverHost: "127.0.0.1" },
    { serverHost: "bad..host" },
    { streamUrl: "http://listener.example/stream" },
    { streamUrl: "https://127.0.0.1/stream" },
    { streamUrl: "https://user:pass@listener.example/stream" }
  ]) {
    assert.deepEqual(planPreprovisionedRadioStream({ station, slots: [slot("1", override)], occupiedConfigs: [] }), { ready: false, reason: "INVALID_INVENTORY" });
  }
});

test("preserves station and slot ownership boundaries", () => {
  assert.deepEqual(planPreprovisionedRadioStream({ station: { ...station, productFamily: "RETAIL" }, slots: [slot("1")] }), { ready: false, reason: "ONLINE_RADIO_REQUIRED" });
  assert.deepEqual(planPreprovisionedRadioStream({ station: { ...station, streamConfig: {} }, slots: [slot("1")] }), { ready: false, reason: "STATION_ALREADY_CONFIGURED" });
  assert.deepEqual(planPreprovisionedRadioStream({ station, slots: [slot("1", { stationId: "another-station" })], occupiedConfigs: [] }), { ready: false, reason: "NO_ELIGIBLE_STREAM_SLOT" });
  assert.deepEqual(planPreprovisionedRadioStream({ station, slots: [slot("1", { listenerLimit: 5 })], occupiedConfigs: [] }), { ready: false, reason: "NO_ELIGIBLE_STREAM_SLOT" });
});

test("does not mutate inventory or turn on outbound broadcasting", () => {
  const entry = Object.freeze(slot("1"));
  const result = planPreprovisionedRadioStream({ station: Object.freeze({ ...station }), slots: Object.freeze([entry]), occupiedConfigs: Object.freeze([]) });
  assert.deepEqual(result, { ready: true, slotId: "1" });
  assert.equal(entry.status, "AVAILABLE");
  assert.equal(entry.outboundAutoDjEnabled, undefined);
});
