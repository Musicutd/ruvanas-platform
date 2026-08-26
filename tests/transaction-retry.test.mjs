import assert from "node:assert/strict";
import test from "node:test";
import {
  isRetryableTransactionError,
  runSerializableTransaction
} from "../lib/transaction-retry.mjs";

test("transaction retries serialization and uniqueness races", async () => {
  let attempts = 0;
  const database = {
    async $transaction(operation, options) {
      attempts += 1;
      assert.equal(options.isolationLevel, "Serializable");
      if (attempts < 3) {
        const error = new Error("write conflict");
        error.code = attempts === 1 ? "P2034" : "P2002";
        throw error;
      }
      return operation({ marker: "transaction" });
    }
  };

  const result = await runSerializableTransaction(
    database,
    async (transaction) => transaction.marker
  );

  assert.equal(result, "transaction");
  assert.equal(attempts, 3);
});

test("transaction retry does not hide unrelated database failures", async () => {
  const failure = Object.assign(new Error("database unavailable"), {
    code: "P1001"
  });
  const database = {
    async $transaction() {
      throw failure;
    }
  };

  await assert.rejects(
    runSerializableTransaction(database, async () => null),
    failure
  );
  assert.equal(isRetryableTransactionError(failure), false);
});
