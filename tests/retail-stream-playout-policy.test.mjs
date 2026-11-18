import test from "node:test";
import assert from "node:assert/strict";
import { retailCapacityAssignments, retailCapacityAssignment, retailCapacityPools, retailProgrammeInput, retailBudget, retailChargedBytes,
  signRetailPlayoutCommand, verifyRetailPlayoutCommand, retailTrackFingerprint } from "../lib/retail-stream-playout-policy.mjs";

const assignment = () => ({ organisationId: "retail-a", stationId: "station-a", workerId: "srv-retail-pool", slot: "one",
  monthlyBudgetUsd: 15, monthlyComputeUsd: 7, monthlyOtherReserveUsd: 0.75, bandwidthUsdPerGB: 0.15, maxBitrateKbps: 128 });
const env = rows => ({ RUVANAS_RETAIL_CAPACITY: JSON.stringify(rows) });
const reason = value => ({ code: `RETAIL_PLAYOUT_${value}` });

test("no server capacity is fail-closed; scope and worker must match the approved assignment", () => {
  assert.deepEqual(retailCapacityAssignments({}), []);
  assert.throws(() => retailCapacityAssignment({}, { organisationId: "retail-a", stationId: "station-a" }), reason("CAPACITY_NOT_ASSIGNED"));
  assert.equal(retailCapacityAssignment(env([assignment()]), { organisationId: "retail-a", stationId: "station-a", workerId: "srv-retail-pool" }).slot, "one");
  assert.throws(() => retailCapacityAssignment(env([assignment()]), { organisationId: "retail-b", stationId: "station-a" }), reason("CAPACITY_NOT_ASSIGNED"));
  assert.throws(() => retailCapacityAssignment(env([assignment()]), { organisationId: "retail-a", stationId: "station-a", workerId: "foreign-worker" }), reason("CAPACITY_NOT_ASSIGNED"));
});
test("operator assignments reject reserved Test Radio resources, malformed costs, and duplicate organisation/station/slots", () => {
  for (const mutation of [{ stationId: "cmvcnbwi20008hr23sd76psi8" }, { workerId: "srv-damhnbv40ujc73b00lgg" },
    { workerId: "ruvanas-radio-test-105-encoder" }, { monthlyBudgetUsd: 7 }, { monthlyComputeUsd: -1 },
    { bandwidthUsdPerGB: 0 }, { maxBitrateKbps: 1000 }, { secret: "not-allowed" }]) {
    assert.throws(() => retailCapacityAssignments(env([{ ...assignment(), ...mutation }])), reason("CAPACITY_INVALID"));
  }
  for (const other of [{ ...assignment(), stationId: "station-b", slot: "two" },
    { ...assignment(), organisationId: "retail-b", slot: "two" },
    { ...assignment(), organisationId: "retail-b", stationId: "station-b" }]) {
    assert.throws(() => retailCapacityAssignments(env([assignment(), other])), reason("CAPACITY_CONFLICT"));
  }
});
test("programme genre normalization is explicit and duplicate aliases are refused", () => {
  assert.deepEqual(retailProgrammeInput({ territory: "MT", genreCodes: ["pop", "DANCE"] }).genreCodes, ["DANCE", "POP"]);
  assert.throws(() => retailProgrammeInput({ territory: "MT", genreCodes: ["pop", "POP"] }), reason("PROGRAMME_INVALID"));
  assert.throws(() => retailProgrammeInput({ territory: "WORLDWIDE", genreCodes: [] }), reason("PROGRAMME_INVALID"));
});
test("pooled compute is bounded to tested four slots and cannot double-count a statically assigned worker", () => {
  const { organisationId: _org, stationId: _station, slot: _slot, ...pool } = assignment();
  assert.equal(retailCapacityPools({ RUVANAS_RETAIL_POOL: JSON.stringify([{ ...pool, slots: 4 }]) })[0].slots, 4);
  assert.throws(() => retailCapacityPools({ RUVANAS_RETAIL_POOL: JSON.stringify([{ ...pool, slots: 5 }]) }), reason("CAPACITY_INVALID"));
  assert.throws(() => retailCapacityPools({ ...env([assignment()]), RUVANAS_RETAIL_POOL: JSON.stringify([{ ...pool, slots: 1 }]) }), reason("CAPACITY_CONFLICT"));
});
test("commands are domain-signed and cannot be moved to another tenant or mutated", () => {
  const config = { SECRET_ENCRYPTION_KEY: "11".repeat(32) }, command = { organisationId: "retail-a", stationId: "station-a", action: "START" };
  const envelope = { command, signature: signRetailPlayoutCommand(command, config) };
  assert.equal(verifyRetailPlayoutCommand(envelope, config), true);
  assert.equal(verifyRetailPlayoutCommand({ ...envelope, command: { ...command, organisationId: "retail-b" } }, config), false);
  assert.equal(verifyRetailPlayoutCommand(envelope, {}), false);
});
test("budget reserves compute, other costs and wire overhead; track identity handles Prisma BigInt", () => {
  const budget = retailBudget(assignment(), 128);
  assert.equal(budget.maximumChargedBytes, Math.floor(7.25 / 0.15 * 1e9));
  assert.equal(retailChargedBytes(1000), 1050);
  assert.throws(() => retailChargedBytes(0), reason("RESERVATION_INVALID"));
  assert.throws(() => retailChargedBytes(3 * 1024 * 1024), reason("RESERVATION_INVALID"));
  const track = { id: "track", permittedUses: ["RETAIL_RADIO"], mediaAsset: { id: "asset", sizeBytes: 12000n, durationSeconds: 180 } };
  assert.match(retailTrackFingerprint(track), /^[a-f0-9]{64}$/);
  assert.notEqual(retailTrackFingerprint(track), retailTrackFingerprint({ ...track, permittedUses: ["ONLINE_RADIO"] }));
});
