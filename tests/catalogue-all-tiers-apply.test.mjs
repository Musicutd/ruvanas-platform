import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CATALOGUE_ALL_TIERS_MIGRATION, catalogueAllTiersApplyMode, catalogueAllTiersColumnState,
  readPinnedCatalogueAllTiersSql, runCatalogueAllTiersAddition } from "../scripts/catalogue-all-tiers-apply.mjs";

const ENV = { NODE_ENV: "production", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW", RENDER_SERVICE_ID: "srv-da03b5lbedkc739q74k0",
  RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
  RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test",
  RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
  DATABASE_URL: "postgresql://synthetic:never-print-this@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011?schema=public" };
const COLUMN = { tableName: "Track", columnName: "catalogueAllTiers", dataType: "boolean", nullable: "NO",
  defaultValue: "false", identity: "NO", generated: "NEVER" };
const clone = structuredClone;

function database() {
  const state = { columns: [], identity: [{ databaseName: "ruvanas_private_preview_20261011", schemaName: "public", serverVersion: 170000 }],
    table: [{ kind: "r", persistence: "p", partition: false }], triggers: [{ enabled: 0 }],
    tracks: [{ id: "existing", catalogueMinimumLevel: "PREMIUM", untouched: "synthetic" }],
    pendingMigrations: ["unrelated-never-apply"], streams: { radio: "RUNNING", retail: "RUNNING" } };
  const calls = { connects: 0, ddl: 0, locks: 0, disconnects: 0, rollbacks: 0, sql: [], readonly: false };
  let afterLock, afterDdl, fault;
  const db = { async $transaction(operation, options) {
    assert.deepEqual(options, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
    const copy = clone(state.columns);
    calls.readonly = false;
    const tx = {
      async $executeRaw(strings) {
        const sql = strings.join(""); calls.sql.push(sql);
        if (sql === "SET TRANSACTION READ ONLY") calls.readonly = true;
        else if (sql === 'LOCK TABLE "public"."Track" IN ACCESS EXCLUSIVE MODE') {
          assert.equal(calls.readonly, false);
          assert.ok(calls.sql.includes("SET LOCAL lock_timeout = '2000ms'"));
          assert.ok(calls.sql.includes("SET LOCAL statement_timeout = '10000ms'"));
          calls.locks++;
          if (fault === "lock") throw new Error("sensitive connection never-print-this");
          await afterLock?.(copy);
        } else assert.match(sql, /^SET LOCAL (statement_timeout|lock_timeout|search_path) = /);
        return 0;
      },
      async $queryRaw(strings) {
        const sql = strings.join(""); calls.sql.push(sql);
        if (sql.includes("current_database()")) return clone(state.identity);
        if (sql.includes("pg_catalog.pg_class")) return clone(state.table);
        if (sql.includes("pg_catalog.pg_event_trigger")) return clone(state.triggers);
        assert.match(sql, /FROM information_schema.columns/);
        assert.match(sql, /table_schema = 'public' AND table_name = 'Track' AND column_name = 'catalogueAllTiers'/);
        return clone(copy);
      },
      async $executeRawUnsafe(sql) {
        assert.equal(calls.readonly, false);
        assert.equal(calls.locks > 0, true);
        assert.equal(sql, await readPinnedCatalogueAllTiersSql());
        assert.ok(calls.sql.includes("SET LOCAL search_path = public, pg_catalog"));
        calls.sql.push(sql); calls.ddl++;
        if (fault === "ddl") throw new Error("sensitive connection never-print-this");
        copy.push(clone(COLUMN));
        afterDdl?.(copy);
        return 0;
      }
    };
    try { const result = await operation(tx); state.columns = copy; return result; }
    catch (error) { calls.rollbacks++; throw error; }
  }, async $disconnect() { calls.disconnects++; if (fault === "disconnect") throw new Error("never-print-this"); } };
  return { state, calls, afterLock: value => { afterLock = value; }, afterDdl: value => { afterDdl = value; },
    fault: value => { fault = value; }, options: { env: clone(ENV), connect: async () => { calls.connects++; return db; } } };
}

test("column addition is opt-in and default check is read-only without locks", async () => {
  assert.equal(catalogueAllTiersApplyMode(), "check");
  assert.equal(catalogueAllTiersApplyMode(["--check"]), "check");
  assert.equal(catalogueAllTiersApplyMode(["--apply"]), "apply");
  for (const args of [["apply"], ["--apply", "--check"], ["--apply", "--apply"], ["--other"]]) {
    assert.throws(() => catalogueAllTiersApplyMode(args), /CATALOGUE_COLUMN_ARGUMENTS_INVALID/);
  }
  const f = database(), before = clone(f.state);
  assert.equal((await runCatalogueAllTiersAddition(f.options)).status, "READY_READ_ONLY");
  assert.equal(f.calls.readonly, true);
  assert.equal(f.calls.ddl, 0); assert.equal(f.calls.locks, 0); assert.equal(f.calls.disconnects, 1);
  assert.deepEqual(f.state, before);
});

test("apply adds only the pinned column once, leaves existing data/history/streams unchanged and is idempotent", async () => {
  const f = database(), before = clone(f.state);
  const result = await runCatalogueAllTiersAddition({ ...f.options, mode: "apply" });
  assert.equal(result.status, "APPLIED"); assert.equal(result.columnAdded, true);
  for (const flag of ["rowUpdatesIssued", "migrationHistoryChanged", "otherPendingMigrationsApplied", "streamingControlsChanged"]) {
    assert.equal(result[flag], false);
  }
  assert.deepEqual(f.state, { ...before, columns: [COLUMN] });
  assert.equal(f.calls.ddl, 1); assert.equal(f.calls.locks, 1);
  assert.equal((await runCatalogueAllTiersAddition({ ...f.options, mode: "apply" })).status, "ALREADY_ALIGNED");
  assert.equal(f.calls.ddl, 1); assert.equal(f.calls.locks, 1);
  assert.doesNotMatch(f.calls.sql.join("\n"), /_prisma_migrations|\bUPDATE\b|\bINSERT\b|\bDELETE\b/);
});

test("existing exact column definition passes read-only checks and every incompatible definition refuses DDL", async () => {
  assert.equal(catalogueAllTiersColumnState([]), "MISSING");
  assert.equal(catalogueAllTiersColumnState([COLUMN]), "PRESENT");
  const f = database(); f.state.columns = [clone(COLUMN)];
  assert.equal((await runCatalogueAllTiersAddition(f.options)).status, "ALREADY_ALIGNED");
  assert.equal(f.calls.ddl, 0);
  for (const columns of [null, [COLUMN, COLUMN], ...Object.entries({ tableName: "Other", columnName: "other", dataType: "text",
    nullable: "YES", defaultValue: "true", identity: "YES", generated: "ALWAYS" }).map(([key, value]) => [{ ...COLUMN, [key]: value }])]) {
    const bad = database(); bad.state.columns = columns;
    assert.equal((await runCatalogueAllTiersAddition({ ...bad.options, mode: "apply" })).code, "CATALOGUE_COLUMN_DEFINITION_INVALID");
    assert.equal(bad.calls.ddl, 0); assert.equal(bad.calls.locks, 0);
  }
});

test("website, database, TLS, and closed-registration preflight guards run before connection", async () => {
  for (const patch of [{ RENDER_SERVICE_ID: "srv-damhnbv40ujc73b00lgg" }, { RENDER_SERVICE_ID: "srv-dbeoq2vb9u1s73aeom1g" },
    { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { PGSSLMODE: "disable" },
    { RUVANAS_PUBLIC_URL: "https://foreign.test" },
    { DATABASE_URL: ENV.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "other-host") }]) {
    const f = database(); const result = await runCatalogueAllTiersAddition({ ...f.options, env: { ...ENV, ...patch }, mode: "apply" });
    assert.equal(result.ok, false); assert.equal(f.calls.connects, 0); assert.equal(f.calls.ddl, 0);
    assert.doesNotMatch(JSON.stringify(result), /never-print-this|postgresql/);
  }
  const f = database();
  assert.equal((await runCatalogueAllTiersAddition({ ...f.options, mode: "wrong" })).code, "CATALOGUE_COLUMN_ARGUMENTS_INVALID");
  assert.equal(f.calls.connects, 0);
});

test("wrong live identity, unsafe tables, old PostgreSQL and enabled DDL event triggers refuse additions", async () => {
  for (const mutate of [f => f.state.identity[0].databaseName = "foreign", f => f.state.identity[0].schemaName = "foreign",
    f => f.state.identity[0].serverVersion = 100000, f => f.state.identity[0].serverVersion = "170000",
    f => f.state.table[0].kind = "v", f => f.state.table[0].persistence = "t", f => f.state.table[0].partition = true,
    f => f.state.table = [], f => f.state.triggers[0].enabled = 1]) {
    const f = database(); mutate(f);
    assert.equal((await runCatalogueAllTiersAddition({ ...f.options, mode: "apply" })).ok, false);
    assert.equal(f.calls.ddl, 0); assert.equal(f.calls.locks, 0);
  }
});

test("a concurrent addition is rechecked after the bounded lock and is not added twice", async () => {
  const f = database(); f.afterLock(columns => columns.push(clone(COLUMN)));
  assert.equal((await runCatalogueAllTiersAddition({ ...f.options, mode: "apply" })).status, "ALREADY_ALIGNED");
  assert.equal(f.calls.locks, 1); assert.equal(f.calls.ddl, 0);
  const bad = database(); bad.afterLock(columns => columns.push({ ...COLUMN, nullable: "YES" }));
  assert.equal((await runCatalogueAllTiersAddition({ ...bad.options, mode: "apply" })).code, "CATALOGUE_COLUMN_DEFINITION_INVALID");
  assert.equal(bad.calls.ddl, 0);
});

test("preflight changes and failed postverification roll back and never expose raw errors", async () => {
  const changed = database(); changed.afterLock(() => { changed.options.env.RUVANAS_PRIVATE_PREVIEW_ENABLED = "0"; });
  assert.equal((await runCatalogueAllTiersAddition({ ...changed.options, mode: "apply" })).code, "CATALOGUE_COLUMN_PREFLIGHT_CHANGED");
  assert.equal(changed.calls.ddl, 0);
  for (const mutate of [columns => { columns.length = 0; }, columns => { columns[0].defaultValue = "true"; }]) {
    const f = database(); f.afterDdl(mutate);
    assert.equal((await runCatalogueAllTiersAddition({ ...f.options, mode: "apply" })).ok, false);
    assert.equal(f.calls.rollbacks, 1); assert.deepEqual(f.state.columns, []);
  }
  for (const fault of ["lock", "ddl", "disconnect"]) {
    const f = database(); f.fault(fault);
    const result = await runCatalogueAllTiersAddition({ ...f.options, mode: "apply" });
    assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /never-print-this|postgresql/);
    assert.equal(f.calls.disconnects, 1);
  }
});

test("only unchanged pinned SQL may run and LF/CRLF representations match", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ruvanas-catalogue-column-"));
  try {
    const dir = path.join(root, "prisma/migrations", CATALOGUE_ALL_TIERS_MIGRATION);
    await mkdir(dir, { recursive: true });
    const original = await readPinnedCatalogueAllTiersSql();
    await writeFile(path.join(dir, "migration.sql"), original + "\n-- unreviewed change\n");
    const f = database();
    assert.equal((await runCatalogueAllTiersAddition({ ...f.options, root, mode: "apply" })).code, "CATALOGUE_COLUMN_SQL_CHANGED");
    assert.equal(f.calls.connects, 0);
    await writeFile(path.join(dir, "migration.sql"), original.replace(/\n/g, "\r\n"));
    assert.equal(await readPinnedCatalogueAllTiersSql(root), original);
    const changed = database();
    changed.afterLock(() => writeFile(path.join(dir, "migration.sql"), original + "\n-- changed after connection\n"));
    assert.equal((await runCatalogueAllTiersAddition({ ...changed.options, root, mode: "apply" })).code, "CATALOGUE_COLUMN_SQL_CHANGED");
    assert.equal(changed.calls.ddl, 0); assert.equal(changed.calls.rollbacks, 1);
  } finally {
    if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("ruvanas-catalogue-column-")) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("standalone column step cannot launch a migration runner and is absent from build and worker startup", async () => {
  const files = await Promise.all(["../package.json", "../scripts/start-production.mjs", "../scripts/retail-stream-worker.mjs",
    "../scripts/online-radio-encoder-worker.mjs"].map(file => readFile(new URL(file, import.meta.url), "utf8")));
  for (const source of files) assert.doesNotMatch(source, /catalogue-all-tiers-apply/);
  const source = await readFile(new URL("../scripts/catalogue-all-tiers-apply.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /child_process|spawn\(|"migrate",|"resolve",|INSERT INTO|DELETE FROM|UPDATE "/);
  const sql = await readPinnedCatalogueAllTiersSql();
  assert.equal(sql.replace(/^--.*\n/gm, "").trim(), 'ALTER TABLE "Track" ADD COLUMN "catalogueAllTiers" BOOLEAN NOT NULL DEFAULT false;');
});
