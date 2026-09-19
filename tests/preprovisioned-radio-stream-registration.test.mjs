import test from "node:test";
import assert from "node:assert/strict";
import { decryptSecret } from "../lib/crypto.js";
import { manualStreamRegistrationPayload } from "../lib/preprovisioned-radio-stream-form.mjs";
import { normalizePreprovisionedRadioStreamInput } from "../lib/preprovisioned-radio-stream.mjs";
import {
  registerPreprovisionedRadioStream,
  RadioStreamRegistrationError
} from "../lib/preprovisioned-radio-stream-registration.mjs";

process.env.SECRET_ENCRYPTION_KEY ||= "11".repeat(32);

const validInput = {
  centovaUsername: "ruvanas_studio_test",
  streamUrl: "https://test-radio.example.org/stream",
  serverHost: "source.example.org",
  serverPort: 8198,
  sourcePort: 8198,
  sourceUsername: "",
  sourcePassword: "test-source-secret",
  listenerLimit: 10,
  maxBitrateKbps: 128
};

function fakeDatabase({ inventory = [], occupied = [], assigned = [] } = {}) {
  const writes = [];
  const tx = {
    preprovisionedRadioStream: {
      findMany: async () => inventory,
      create: async ({ data }) => {
        writes.push(["slot", data]);
        const { sourcePasswordEncrypted: _secret, verifiedAt: _verifiedAt, stationId: _stationId, claimedAt: _claimedAt, ...safe } = data;
        return { id: "slot-test", ...safe };
      }
    },
    stationStreamConfig: { findMany: async () => occupied },
    station: { findMany: async () => assigned },
    auditLog: { create: async ({ data }) => { writes.push(["audit", data]); } }
  };
  return {
    database: {
      $transaction: async (operation, options) => {
        assert.equal(options.isolationLevel, "Serializable");
        return operation(tx);
      }
    },
    writes
  };
}

test("registers an encrypted slot in quarantine, with no secret in its result or audit", async () => {
  const { database, writes } = fakeDatabase();
  const result = await registerPreprovisionedRadioStream(database, { input: validInput, actorUserId: "admin-test" });
  assert.equal(result.status, "QUARANTINED");
  assert.equal(result.verifiedAt, undefined);
  assert.equal(result.sourcePasswordEncrypted, undefined);
  assert.equal(writes[0][1].verifiedAt, null);
  assert.equal(writes[0][1].stationId, null);
  assert.equal(decryptSecret(writes[0][1].sourcePasswordEncrypted), validInput.sourcePassword);
  assert.equal(writes[1][1].actorUserId, "admin-test");
  assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(writes[1]), /test-source-secret|sourcePasswordEncrypted/);
});

test("rejects unsafe or incomplete source details before writing", async () => {
  const { database, writes } = fakeDatabase();
  for (const change of [
    { streamUrl: "http://test-radio.example.org/stream" },
    { streamUrl: "https://127.0.0.1/stream" },
    { streamUrl: "https://name:password@test-radio.example.org/stream" },
    { serverHost: "localhost" },
    { sourcePort: 0 },
    { sourcePassword: "" },
    { maxBitrateKbps: 500 }
  ]) {
    assert.throws(() => normalizePreprovisionedRadioStreamInput({ ...validInput, ...change }), /INVALID_STREAM_SLOT/);
    await assert.rejects(
      registerPreprovisionedRadioStream(database, { input: { ...validInput, ...change }, actorUserId: "admin-test" }),
      (error) => error instanceof RadioStreamRegistrationError && error.code === "INVALID_STREAM_SLOT"
    );
  }
  assert.equal(writes.length, 0);
});

test("rejects an endpoint or account already in the pool or at a station", async () => {
  for (const data of [
    { inventory: [{ centovaUsername: "RUVANAS_STUDIO_TEST" }] },
    { inventory: [{ streamUrl: validInput.streamUrl }] },
    { occupied: [{ serverHost: "SOURCE.EXAMPLE.ORG", sourcePort: 8198 }] },
    { assigned: [{ providerAccountId: validInput.centovaUsername }] }
  ]) {
    const { database, writes } = fakeDatabase(data);
    await assert.rejects(
      registerPreprovisionedRadioStream(database, { input: validInput, actorUserId: "admin-test" }),
      (error) => error instanceof RadioStreamRegistrationError && error.code === "STREAM_SLOT_ALREADY_USED"
    );
    assert.equal(writes.length, 0);
  }
});

test("requires an authenticated actor", async () => {
  const { database, writes } = fakeDatabase();
  await assert.rejects(
    registerPreprovisionedRadioStream(database, { input: validInput, actorUserId: null }),
    (error) => error instanceof RadioStreamRegistrationError && error.code === "ACTOR_REQUIRED"
  );
  assert.equal(writes.length, 0);
});

test("the simplified Streamerr form uses one port unless a separate listener port is selected", () => {
  const fields = { ...validInput, sourcePort: "8198", serverPort: "8393", listenerLimit: "10", maxBitrateKbps: "128" };
  const simple = manualStreamRegistrationPayload(fields);
  const separate = manualStreamRegistrationPayload(fields, { differentPort: true });
  assert.equal(simple.serverPort, "8198");
  assert.equal(simple.sourcePort, "8198");
  assert.equal(separate.serverPort, "8393");
  assert.equal(separate.sourcePort, "8198");
  assert.equal(normalizePreprovisionedRadioStreamInput(simple).serverPort, 8198);
  assert.equal(normalizePreprovisionedRadioStreamInput(separate).serverPort, 8393);
});
