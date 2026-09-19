import test from "node:test";
import assert from "node:assert/strict";
import { claimPreprovisionedRadioStream, PreprovisionedRadioStreamError } from "../lib/preprovisioned-radio-stream-service.mjs";

const slot = (id, overrides = {}) => ({
  id,
  providerKey: "CENTOVA_CAST",
  centovaUsername: `station_${id}`,
  streamUrl: `https://station-${id}.example.test/stream`,
  serverHost: "source.example.test",
  serverPort: 8_100 + Number(id),
  sourcePort: 8_100 + Number(id),
  sourceUsername: null,
  sourcePasswordEncrypted: "encrypted-test-secret",
  listenerLimit: 10,
  maxBitrateKbps: 128,
  status: "AVAILABLE",
  verifiedAt: new Date("2026-09-19T00:00:00.000Z"),
  stationId: null,
  ...overrides
});

const station = (overrides = {}) => ({
  id: "station-test",
  organisationId: "organisation-test",
  productFamily: "ONLINE",
  status: "PENDING_SETUP",
  listenerLimit: 10,
  maxBitrateKbps: 128,
  providerAccountId: null,
  streamConfig: null,
  organisation: { subscription: {
    status: "ACTIVE",
    plan: { active: true, onlineRadioEnabled: true, stationLimit: 2, storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128 }
  } },
  ...overrides
});

function fakeDatabase({ currentStation = station(), inventory = [slot("1")], occupied = [], raceOnce = false } = {}) {
  const writes = [];
  const rows = inventory.map((entry) => ({ ...entry }));
  let raced = false;
  const tx = {
    station: {
      findUnique: async () => currentStation,
      update: async (args) => { writes.push(["station.update", args]); return args.data; }
    },
    preprovisionedRadioStream: {
      findMany: async () => rows.filter((entry) => entry.status === "AVAILABLE"),
      updateMany: async (args) => {
        if (raceOnce && !raced) {
          raced = true;
          rows.find((entry) => entry.id === args.where.id).status = "CLAIMED";
          return { count: 0 };
        }
        const row = rows.find((entry) => entry.id === args.where.id && entry.status === args.where.status && entry.stationId === args.where.stationId);
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        writes.push(["slot.updateMany", args]);
        return { count: 1 };
      }
    },
    stationStreamConfig: {
      findMany: async () => occupied,
      create: async (args) => { writes.push(["streamConfig.create", args]); return args.data; }
    },
    auditLog: { create: async (args) => { writes.push(["auditLog.create", args]); return args.data; } }
  };
  const database = {
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      return operation(tx);
    }
  };
  return { database, writes, rows };
}

test("atomically claims an existing stream while keeping outbound audio disabled", async () => {
  const { database, writes, rows } = fakeDatabase();
  const result = await claimPreprovisionedRadioStream(database, { stationId: "station-test", now: "2026-09-19T12:00:00.000Z" });
  assert.deepEqual(result, { stationId: "station-test", slotId: "1", outboundAutoDjEnabled: false });
  assert.equal(rows[0].status, "CLAIMED");
  assert.equal(rows[0].stationId, "station-test");
  assert.equal(writes[0][1].where.status, "AVAILABLE");
  assert.equal(writes[0][1].where.stationId, null);
  assert.equal(writes[1][1].data.outboundAutoDjEnabled, false);
  assert.equal(writes[1][1].data.sourcePasswordEncrypted, "encrypted-test-secret");
  assert.equal(writes[3][1].data.action, "ONLINE_RADIO_STREAM_SLOT_CLAIMED");
  assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(writes[3]), /encrypted-test-secret|source\.example/);
});

test("never changes an already configured station or a station without Online Radio access", async () => {
  const existing = fakeDatabase({ currentStation: station({ streamConfig: { id: "existing" } }) });
  await assert.rejects(
    claimPreprovisionedRadioStream(existing.database, { stationId: "station-test" }),
    (error) => error instanceof PreprovisionedRadioStreamError && error.code === "STATION_ALREADY_CONFIGURED"
  );
  assert.equal(existing.writes.length, 0);

  const disabled = fakeDatabase({ currentStation: station({ organisation: { subscription: { status: "SUSPENDED", plan: { active: true, onlineRadioEnabled: true } } } }) });
  await assert.rejects(
    claimPreprovisionedRadioStream(disabled.database, { stationId: "station-test" }),
    (error) => error instanceof PreprovisionedRadioStreamError && error.code === "ONLINE_RADIO_NOT_ENTITLED"
  );
  assert.equal(disabled.writes.length, 0);

  const overLimit = fakeDatabase({ currentStation: station({ maxBitrateKbps: 320 }) });
  await assert.rejects(
    claimPreprovisionedRadioStream(overLimit.database, { stationId: "station-test" }),
    (error) => error instanceof PreprovisionedRadioStreamError && error.code === "STATION_LIMIT_EXCEEDS_ENTITLEMENT"
  );
  assert.equal(overLimit.writes.length, 0);
});

test("rechecks inventory after a competing claim and chooses a different stream", async () => {
  const { database, rows, writes } = fakeDatabase({ inventory: [slot("1"), slot("2")], raceOnce: true });
  const result = await claimPreprovisionedRadioStream(database, { stationId: "station-test" });
  assert.equal(result.slotId, "2");
  assert.equal(rows[1].stationId, "station-test");
  assert.equal(writes.filter(([name]) => name === "streamConfig.create").length, 1);
});
