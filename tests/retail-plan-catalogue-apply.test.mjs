import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RETAIL_PLAN_CODES, RETAIL_PLAN_MIGRATION, readPinnedRetailPlanSql, retailPlanApplyMode,
  runRetailPlanCorrection, verifyRetailPlanCorrection } from "../scripts/retail-plan-catalogue-apply.mjs";

const ENV = { NODE_ENV: "production", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW", RENDER_SERVICE_ID: "srv-da03b5lbedkc739q74k0",
  RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
  RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test",
  RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
  DATABASE_URL: "postgresql://synthetic:never-print-this@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011?schema=public" };
const clone = structuredClone;
function plans() {
  return [...RETAIL_PLAN_CODES.map((code, index) => ({ id: `plan-${index}`, code, productFamily: "RETAIL", includesRuvanasCatalogue: true,
    licensedMusicCatalogueLevel: ["NONE", "NONE", "FOCUSED", "PROFESSIONAL", "PREMIUM"][index],
    digitalSignageEnabled: true, updatedAt: "2026-11-01T00:00:00.000Z", name: `Custom ${code}`,
    monthlyPriceCents: 1900 + index * 100, stationLimit: [1, 3, 10, 30, 100][index],
    storageLimitGb: [5, 15, 100, 200, 2000][index], maxBitrateKbps: [128, 256, 320, 320, 320][index],
    listenerLimit: 123 + index, retailMediaEnabled: index > 1, customFutureField: { keep: index } })),
  { id: "school", code: "SCHOOL_ADVANCED", productFamily: "SCHOOL", licensedMusicCatalogueLevel: "PROFESSIONAL", digitalSignageEnabled: true },
  { id: "custom-retail", code: "RETAIL_CUSTOM", productFamily: "RETAIL", licensedMusicCatalogueLevel: "PREMIUM", digitalSignageEnabled: true }];
}
function database() {
  const state = { plans: plans(), identity: [{ databaseName: "ruvanas_private_preview_20261011", schemaName: "public" }],
    table: [{ kind: "r", rowSecurity: false, userTriggers: 0, rules: 0 }],
    pendingMigrations: ["unrelated-never-apply"], streams: { radio: "RUNNING", retail: "RUNNING" } };
  const calls = { connects: 0, writes: 0, disconnects: 0, rollbacks: 0, sql: [], readonly: false };
  let corrupt;
  const db = { async $transaction(operation, options) {
    assert.deepEqual(options, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 });
    const copy = clone(state.plans);
    const tx = {
      async $executeRaw(strings) {
        const sql = strings.join(""); calls.sql.push(sql);
        if (sql === "SET TRANSACTION READ ONLY") calls.readonly = true;
        else assert.match(sql, /^SET LOCAL (statement_timeout|lock_timeout|search_path) = /);
        return 0;
      },
      async $queryRaw(strings) {
        const sql = strings.join(""); calls.sql.push(sql);
        if (sql.includes("current_database()")) return clone(state.identity);
        if (sql.includes("pg_catalog.pg_class")) return clone(state.table);
        if (sql.includes("FOR UPDATE")) {
          assert.match(sql, /"productFamily" = 'RETAIL'/);
          assert.deepEqual([...sql.matchAll(/'(RETAIL_[A-Z]+)'/g)].map(match => match[1]), [...RETAIL_PLAN_CODES]);
          return copy.filter(row => RETAIL_PLAN_CODES.includes(row.code) && row.productFamily === "RETAIL").map(row => ({ id: row.id }));
        }
        assert.match(sql, /^SELECT to_jsonb\(p\) AS "plan" FROM "public"\."Plan"/);
        return copy.map(plan => ({ plan: clone(plan) }));
      },
      async $executeRawUnsafe(sql) {
        assert.equal(calls.readonly, false); assert.equal(sql, await readPinnedRetailPlanSql());
        calls.sql.push(sql); calls.writes++;
        let count = 0;
        for (const row of copy) if (row.productFamily === "RETAIL" && RETAIL_PLAN_CODES.includes(row.code) &&
          (row.licensedMusicCatalogueLevel !== "FOCUSED" || row.digitalSignageEnabled)) {
          row.licensedMusicCatalogueLevel = "FOCUSED"; row.digitalSignageEnabled = false;
          row.updatedAt = "2026-11-08T00:00:00.000Z"; count++;
        }
        corrupt?.(copy);
        return count;
      }
    };
    try { const result = await operation(tx); state.plans = copy; return result; }
    catch (error) { calls.rollbacks++; throw error; }
  }, async $disconnect() { calls.disconnects++; } };
  return { state, calls, corrupt: value => { corrupt = value; }, options: { env: clone(ENV), connect: async () => { calls.connects++; return db; } } };
}

test("Retail correction is opt-in and its check mode makes no data writes", async () => {
  assert.equal(retailPlanApplyMode(), "check"); assert.equal(retailPlanApplyMode(["--check"]), "check");
  assert.equal(retailPlanApplyMode(["--apply"]), "apply");
  for (const args of [["apply"], ["--apply", "--check"], ["--apply", "--anything"]]) assert.throws(() => retailPlanApplyMode(args));
  const f = database(), before = clone(f.state);
  const result = await runRetailPlanCorrection(f.options);
  assert.equal(result.status, "READY_READ_ONLY"); assert.equal(result.requiredChanges, 5);
  assert.equal(f.calls.readonly, true); assert.equal(f.calls.writes, 0); assert.equal(f.calls.disconnects, 1);
  assert.deepEqual(f.state, before);
});

test("apply changes exactly five Retail plans, preserves custom fields and other plans, and is idempotent", async () => {
  const f = database(), before = clone(f.state);
  const result = await runRetailPlanCorrection({ ...f.options, mode: "apply" });
  assert.equal(result.status, "APPLIED"); assert.equal(result.updatedRows, 5);
  assert.equal(result.migrationHistoryChanged, false); assert.equal(result.otherPendingMigrationsApplied, false);
  assert.equal(result.streamingControlsChanged, false); assert.equal(verifyRetailPlanCorrection(before.plans, f.state.plans, 5), 5);
  assert.deepEqual(f.state.pendingMigrations, before.pendingMigrations); assert.deepEqual(f.state.streams, before.streams);
  assert.equal(f.calls.writes, 1);
  assert.equal((await runRetailPlanCorrection({ ...f.options, mode: "apply" })).status, "ALREADY_ALIGNED");
  assert.equal(f.calls.writes, 1);
  assert.doesNotMatch(f.calls.sql.join("\n"), /_prisma_migrations|"Subscription"|"Station"|"Track"/);
});

test("already-correct target rows do not get a new updatedAt", async () => {
  const f = database(); Object.assign(f.state.plans[0], { licensedMusicCatalogueLevel: "FOCUSED", digitalSignageEnabled: false });
  const before = clone(f.state.plans[0]);
  const result = await runRetailPlanCorrection({ ...f.options, mode: "apply" });
  assert.equal(result.updatedRows, 4); assert.deepEqual(f.state.plans[0], before);
});

test("host, database, TLS and registration guards run before any connection", async () => {
  for (const patch of [{ RENDER_SERVICE_ID: "srv-damhnbv40ujc73b00lgg" }, { RENDER_SERVICE_ID: "srv-dbeoq2vb9u1s73aeom1g" },
    { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { DATABASE_URL: ENV.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "other-host") }]) {
    const f = database(); const result = await runRetailPlanCorrection({ ...f.options, env: { ...ENV, ...patch }, mode: "apply" });
    assert.equal(result.ok, false); assert.equal(f.calls.connects, 0); assert.equal(f.calls.writes, 0);
    assert.doesNotMatch(JSON.stringify(result), /never-print-this|postgresql/);
  }
});

test("wrong live identity, hidden rows, triggers, rules, missing targets and wrong family refuse updates", async () => {
  for (const mutate of [f => f.state.identity[0].databaseName = "foreign", f => f.state.identity[0].schemaName = "foreign",
    f => f.state.table[0].kind = "v", f => f.state.table[0].rowSecurity = true, f => f.state.table[0].userTriggers = 1,
    f => f.state.table[0].rules = 1, f => f.state.plans.shift(), f => f.state.plans[0].productFamily = "ONLINE",
    f => f.state.plans[0].digitalSignageEnabled = null, f => f.state.plans[0].licensedMusicCatalogueLevel = "UNLIMITED"]) {
    const f = database(); mutate(f); const before = clone(f.state.plans);
    assert.equal((await runRetailPlanCorrection({ ...f.options, mode: "apply" })).ok, false);
    assert.equal(f.calls.writes, 0); assert.deepEqual(f.state.plans, before);
  }
});

test("unexpected collateral changes or failed postverification roll back the entire update", async () => {
  for (const mutate of [rows => rows[0].stationLimit++, rows => rows[0].customFutureField.keep++,
    rows => rows.at(-1).digitalSignageEnabled = false, rows => rows[0].licensedMusicCatalogueLevel = "PREMIUM",
    rows => rows.pop(), rows => rows[0].name = "unapproved rename"]) {
    const f = database(), before = clone(f.state.plans); f.corrupt(mutate);
    const result = await runRetailPlanCorrection({ ...f.options, mode: "apply" });
    assert.equal(result.code, "RETAIL_PLAN_POSTCHECK_FAILED"); assert.equal(f.calls.rollbacks, 1);
    assert.deepEqual(f.state.plans, before);
  }
});

test("a changed migration file is refused before connecting, without reading unrelated migrations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ruvanas-retail-plan-"));
  try {
    const dir = path.join(root, "prisma/migrations", RETAIL_PLAN_MIGRATION); await mkdir(dir, { recursive: true });
    const original = await readPinnedRetailPlanSql();
    await writeFile(path.join(dir, "migration.sql"), original + "\n-- unreviewed change\n");
    const f = database(); const result = await runRetailPlanCorrection({ ...f.options, root, mode: "apply" });
    assert.equal(result.code, "RETAIL_PLAN_SQL_CHANGED"); assert.equal(f.calls.connects, 0);
    await writeFile(path.join(dir, "migration.sql"), original.replace(/\n/g, "\r\n"));
    assert.equal(await readPinnedRetailPlanSql(root), original);
  } finally {
    if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("ruvanas-retail-plan-")) await rm(root, { recursive: true, force: true });
  }
});

test("the standalone script is never wired into web startup, build or encoder commands", async () => {
  const files = await Promise.all(["../package.json", "../scripts/start-production.mjs", "../scripts/retail-stream-worker.mjs",
    "../scripts/online-radio-encoder-worker.mjs"].map(file => readFile(new URL(file, import.meta.url), "utf8")));
  for (const source of files) assert.doesNotMatch(source, /retail-plan-catalogue-apply/);
  const source = await readFile(new URL("../scripts/retail-plan-catalogue-apply.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /child_process|spawn\(|"migrate",|"resolve",|INSERT INTO|DELETE FROM/);
});
