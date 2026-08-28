import assert from "node:assert/strict";
import test from "node:test";
import {
  creditMovement,
  fundingAllowsDelivery,
  fundingAllowsProduction,
  nextCreditBalance
} from "../lib/production-credits.mjs";

test("production-credit movements keep available and reserved balances separate", () => {
  assert.deepEqual(creditMovement("GRANT", 4), { availableDelta: 4, reservedDelta: 0 });
  assert.deepEqual(creditMovement("RESERVE", 1), { availableDelta: -1, reservedDelta: 1 });
  assert.deepEqual(creditMovement("CONSUME", 1), { availableDelta: 0, reservedDelta: -1 });
  assert.deepEqual(creditMovement("RELEASE", 1), { availableDelta: 1, reservedDelta: -1 });
});

test("ledger balances never become negative", () => {
  assert.deepEqual(nextCreditBalance({ available: 2, reserved: 0, entryType: "RESERVE", quantity: 1 }), {
    availableDelta: -1,
    reservedDelta: 1,
    availableAfter: 1,
    reservedAfter: 1
  });
  assert.throws(() => nextCreditBalance({ available: 0, reserved: 0, entryType: "RESERVE", quantity: 1 }), /not enough available/);
  assert.throws(() => nextCreditBalance({ available: 1, reserved: 0, entryType: "CONSUME", quantity: 1 }), /not enough reserved/);
});

test("manual adjustments may add or remove credits within safe balances", () => {
  assert.equal(nextCreditBalance({ available: 3, reserved: 0, entryType: "ADJUSTMENT", quantity: -2 }).availableAfter, 1);
  assert.throws(() => nextCreditBalance({ available: 1, reserved: 0, entryType: "ADJUSTMENT", quantity: -2 }), /not enough available/);
  assert.throws(() => creditMovement("GRANT", -1), /positive whole number/);
  assert.throws(() => creditMovement("ADJUSTMENT", 0), /non-zero whole number/);
});

test("only reserved or grandfathered orders may enter production and delivery", () => {
  assert.equal(fundingAllowsProduction("RESERVED"), true);
  assert.equal(fundingAllowsDelivery("LEGACY_UNMETERED"), true);
  assert.equal(fundingAllowsProduction("PENDING"), false);
  assert.equal(fundingAllowsDelivery("RELEASED"), false);
});


