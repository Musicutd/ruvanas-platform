import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runGeneralSourceWriteTransaction } from "../lib/general-source-write-transaction.mjs";

test("general source writes replay the entire DB decision after a rolled-back conflict", async () => {
  const seen = [];
  const db = { $transaction: async (operation, options) => {
    assert.deepEqual(options, { isolationLevel: "ReadCommitted", timeout: 15_000 });
    const attempt = seen.length + 1;
    return operation({ attempt });
  } };
  const result = await runGeneralSourceWriteTransaction(db, async (tx) => {
    seen.push(tx.attempt);
    if (tx.attempt === 1) throw Object.assign(new Error("rolled back"), { code: "P2034" });
    if (tx.attempt === 2) throw Object.assign(new Error("raw deadlock rollback"), { code: "P2010", meta: { code: "40P01" } });
    return { attempt: tx.attempt, sourceRechecked: true };
  });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(result, { attempt: 3, sourceRechecked: true });
});

test("a privacy decision made on a retry cannot reuse the first attempt's ordinary source", async () => {
  let attempts = 0;
  let writeAttempts = 0;
  const privateSource = Object.assign(new Error("private source"), { code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED", status: 403 });
  const db = { $transaction: async (operation) => {
    attempts += 1;
    return operation({ sourceIsPrivate: attempts > 1 });
  } };
  await assert.rejects(runGeneralSourceWriteTransaction(db, async (tx) => {
    if (tx.sourceIsPrivate) throw privateSource;
    writeAttempts += 1;
    throw Object.assign(new Error("write rolled back"), { code: "P2034" });
  }), (error) => error === privateSource);
  assert.equal(attempts, 2);
  assert.equal(writeAttempts, 1);
});

test("persistent deadlocks exhaust exactly three attempts and preserve the last error", async () => {
  let attempts = 0;
  const failure = Object.assign(new Error("deadlock"), { code: "P2010", meta: { code: "40P01" } });
  const db = { $transaction: async () => { attempts += 1; throw failure; } };
  await assert.rejects(runGeneralSourceWriteTransaction(db, async () => null), (error) => error === failure);
  assert.equal(attempts, 3);
});

test("ambiguous writes, uniqueness conflicts, privacy changes and unrelated raw errors never replay", async (t) => {
  for (const details of [
    { code: "P1001" }, { code: "P2028" }, { code: "P2002" },
    { code: "P2010", meta: { code: "23505" } }, { code: "P2010", meta: { code: "40001" } },
    { code: "P2010" }, { code: "GENERAL_STUDIO_SOURCE_CHANGED", status: 409 },
    { code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED", status: 403 }, {}
  ]) {
    await t.test(`${details.code || "unknown"}:${details.meta?.code || ""}`, async () => {
      let attempts = 0;
      const failure = Object.assign(new Error("outcome must not be replayed"), details);
      const db = { $transaction: async () => { attempts += 1; throw failure; } };
      await assert.rejects(runGeneralSourceWriteTransaction(db, async () => null), (error) => error === failure);
      assert.equal(attempts, 1);
    });
  }
});

test("Newsroom and Learning use the DB-only wrapper without changing shared Serializable semantics", async () => {
  for (const file of [
    "../app/api/newsroom/route.js", "../app/api/school-radio/newsroom/route.js", "../app/api/school-radio/learning/route.js"
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /runGeneralSourceWriteTransaction\(prisma, async \(tx\)/);
    assert.doesNotMatch(source, /prisma\.\$transaction\(/);
  }
  const shared = await readFile(new URL("../lib/transaction-retry.mjs", import.meta.url), "utf8");
  assert.match(shared, /isolationLevel: "Serializable"/);
  assert.doesNotMatch(shared, /runGeneralSourceWriteTransaction/);
});
