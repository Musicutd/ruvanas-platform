import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPreviewMigrationCatalog, PREVIEW_ACCESS_MIGRATION, PREVIEW_ACCESS_MIGRATION_CHECKSUM } from "../scripts/private-preview-access-migrate.mjs";
import { CATALOGUE_TEST_MIGRATION as OLD, CATALOGUE_TEST_MIGRATION_CHECKSUM as OLD_HASH,
  catalogueTestMigrationPreflight } from "../scripts/catalogue-test-migrate.mjs";
import { CATALOGUE_TEST_HOUR_MIGRATION as NEW, CATALOGUE_TEST_HOUR_MIGRATION_CHECKSUM as HASH,
  CATALOGUE_TEST_HOUR_CONSTRAINTS as CONSTRAINTS, decideCatalogueTestHourMigration, runCatalogueTestHourMigration } from "../scripts/catalogue-test-hour-migrate.mjs";

const ENV = { NODE_ENV: "production", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW", RENDER_SERVICE_ID: "srv-da03b5lbedkc739q74k0",
  RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
  RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test",
  RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
  DATABASE_URL: "postgresql://synthetic:never-print-this@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011?schema=public" };
const clone = value => structuredClone(value);
const row = (name, checksum) => ({ migration_name: name, checksum, finished_at: new Date("2026-10-22T00:00:00Z"), rolled_back_at: null });
let root, catalog, prior;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ruvanas-hour-migrate-tests-"));
  for (const entry of await readPreviewMigrationCatalog()) {
    const directory = path.join(root, "prisma/migrations", entry.name);
    await mkdir(directory, { recursive: true });
    await copyFile(new URL(`../prisma/migrations/${entry.name}/migration.sql`, import.meta.url), path.join(directory, "migration.sql"));
  }
  await copyFile(new URL("../prisma/schema.prisma", import.meta.url), path.join(root, "prisma/schema.prisma"));
  await copyFile(new URL("../prisma/migrations/migration_lock.toml", import.meta.url), path.join(root, "prisma/migrations/migration_lock.toml"));
  catalog = await readPreviewMigrationCatalog(root);
  assert.equal(catalog.length, 130);
  assert.equal(catalog.find(entry => entry.name === NEW).checksum, HASH);
  prior = catalog.filter(entry => entry.name !== NEW).map(entry => row(entry.name,
    entry.name === OLD ? OLD_HASH : entry.name === PREVIEW_ACCESS_MIGRATION ? PREVIEW_ACCESS_MIGRATION_CHECKSUM : entry.checksumCRLF || entry.checksum));
});
after(async () => {
  if (root && path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("ruvanas-hour-migrate-tests-")) await rm(root, { recursive: true, force: true });
});

function snapshot(applied = false) {
  const table = "OnlineRadioCatalogueTest", event = "OnlineRadioCatalogueTestEvent";
  const index = (tableName, indexName, unique, columns, predicate = null) => ({ tableName, indexName, unique, columns, predicate, valid: true, ready: true, method: "btree" });
  return { history: clone(applied ? [...prior, row(NEW, HASH)] : prior), activeTestCount: 0,
    tables: [{ tableName: table, kind: "r" }, { tableName: event, kind: "r" }], indexes: [
      index(table, `${table}_pkey`, true, ["id"]), index(table, `${table}_stationId_status_createdAt_idx`, false, ["stationId", "status", "createdAt"]),
      index(table, `${table}_status_expiresAt_idx`, false, ["status", "expiresAt"]),
      index(table, "catalogue_test_one_active_per_station", true, ["stationId"], "(status = ANY (ARRAY['ARMED'::text, 'RUNNING'::text]))"),
      index(event, `${event}_pkey`, true, ["id"]), index(event, `${event}_testId_eventKey_key`, true, ["testId", "eventKey"]),
      index(event, `${event}_testId_occurredAt_idx`, false, ["testId", "occurredAt"]) ],
    constraints: Object.entries(CONSTRAINTS[applied ? "after" : "before"]).map(([name, definition]) =>
      ({ name, definition, kind: "c", validated: true, deferrable: false, deferred: false, noInherit: false })) };
}
function database(applied = false) {
  const state = { snapshot: snapshot(applied), identity: [{ databaseName: "ruvanas_private_preview_20261011", schemaName: "public" }] };
  const calls = { connections: 0, deployments: 0, disconnects: 0, readonly: 0 };
  const db = { async $transaction(operation, options) {
    assert.deepEqual(options, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 });
    return operation({ async $executeRaw(strings) { assert.equal(strings.join(""), "SET TRANSACTION READ ONLY"); calls.readonly++; },
      async $queryRaw(strings) {
        const sql = strings.join("");
        return clone(sql.includes("current_database()") ? state.identity : sql.includes('"_prisma_migrations"') ? state.snapshot.history :
          sql.includes("FROM pg_catalog.pg_constraint") ? state.snapshot.constraints :
          sql.includes("count(*)") ? [{ activeTestCount: state.snapshot.activeTestCount }] :
          sql.includes("FROM pg_catalog.pg_index") ? state.snapshot.indexes : state.snapshot.tables);
      } });
  }, async $disconnect() { calls.disconnects++; } };
  const options = { env: clone(ENV), root, connect: async () => { calls.connections++; return db; },
    deploy: async () => { calls.deployments++; state.snapshot = snapshot(true); } };
  return { state, calls, db, options };
}

test("pins exact 129-row observed history and only the hour migration can be pending", () => {
  assert.equal(decideCatalogueTestHourMigration(catalog, snapshot()).action, "APPLY");
  assert.equal(decideCatalogueTestHourMigration(catalog, snapshot(true)).action, "ALREADY_APPLIED");
  for (const alter of [s => s.history.pop(), s => s.history.push(row("20261208000000_unreviewed", "a".repeat(64))),
    s => { s.history[0].checksum = "a".repeat(64); }, s => { s.history[0].finished_at = null; },
    s => { s.history[1] = clone(s.history[0]); }, s => { s.history.find(r => r.migration_name === OLD).checksum = "a".repeat(64); }]) {
    const s = snapshot(); alter(s); assert.equal(decideCatalogueTestHourMigration(catalog, s).ok, false);
  }
  const changed = clone(catalog); changed.find(r => r.name === NEW).checksum = "a".repeat(64);
  assert.equal(decideCatalogueTestHourMigration(changed, snapshot()).code, "MIGRATION_CATALOG_CHANGED");
  assert.equal(decideCatalogueTestHourMigration([...catalog, { name: "20261208000000_unknown", checksum: "a".repeat(64) }], snapshot()).ok, false);
});

test("completed hour history must have exact checksum; malformed or duplicate rows fail closed", () => {
  for (const change of [s => { s.history.at(-1).checksum = "a".repeat(64); }, s => { s.history.at(-1).finished_at = null; },
    s => { s.history.at(-1).rolled_back_at = new Date(); }, s => { s.history[0] = clone(s.history.at(-1)); }]) {
    const s = snapshot(true); change(s); assert.equal(decideCatalogueTestHourMigration(catalog, s).ok, false);
  }
});

test("pre/post constraints are exact, fully validated, non-deferrable, and one-active index is preserved", () => {
  for (const applied of [false, true]) for (const change of [s => s.constraints.pop(),
    s => { s.constraints[0].definition += " OR TRUE"; }, s => { s.constraints[0].validated = false; },
    s => { s.constraints[0].deferrable = true; }, s => { s.constraints[0].noInherit = true; },
    s => { s.constraints[0].kind = "f"; }, s => { s.constraints[0].name = "other"; },
    s => { s.indexes[3].predicate = "status = 'FAILED'"; }, s => { s.activeTestCount = 1; },
    s => { s.activeTestCount = null; }]) {
    const s = snapshot(applied); change(s); assert.equal(decideCatalogueTestHourMigration(catalog, s).ok, false);
  }
  const wrongPhase = snapshot(true); wrongPhase.constraints = snapshot().constraints;
  assert.equal(decideCatalogueTestHourMigration(catalog, wrongPhase).code, "MIGRATION_HOUR_SCHEMA_INVALID");
});

test("default execution is read-only; explicit apply checks twice, deploys once, then verifies", async () => {
  const check = database();
  assert.equal((await runCatalogueTestHourMigration(check.options)).status, "READY_READ_ONLY");
  assert.equal(check.calls.deployments, 0); assert.equal(check.calls.readonly, 1); assert.equal(check.calls.disconnects, 1);
  const apply = database(), original = clone(apply.state.snapshot.history);
  assert.deepEqual(await runCatalogueTestHourMigration({ ...apply.options, mode: "apply" }),
    { ok: true, status: "APPLIED", migration: NEW, verifiedPriorMigrationCount: 129, streamingStarted: false });
  assert.equal(apply.calls.deployments, 1); assert.equal(apply.calls.readonly, 3);
  assert.deepEqual(apply.state.snapshot.history.slice(0, 129), original);
  assert.equal((await runCatalogueTestHourMigration({ ...apply.options, mode: "apply" })).status, "ALREADY_APPLIED");
  assert.equal(apply.calls.deployments, 1);
});

test("existing pinned service/DB, private registration and disabled output preflight is reused", async () => {
  assert.equal(catalogueTestMigrationPreflight(ENV).ok, true);
  for (const patch of [{ RENDER_SERVICE_ID: "other" }, { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" },
    { RUVANAS_CATALOGUE_TEST_START_ENABLED: "true" }, { RUVANAS_CATALOGUE_TEST_ALLOW_LIVE: "true" },
    { RUVANAS_AUTODJ_ALLOW_LIVE: "true" }, { RUVANAS_AUTODJ_TIMED_OUTPUT_ACCEPTED: "true" },
    { DATABASE_URL: ENV.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "other.example") }]) {
    const f = database(); const result = await runCatalogueTestHourMigration({ ...f.options, env: { ...ENV, ...patch }, mode: "apply" });
    assert.equal(result.ok, false); assert.equal(f.calls.connections, 0); assert.equal(f.calls.deployments, 0);
    assert.doesNotMatch(JSON.stringify(result), /never-print-this|postgresql/);
  }
});

test("unknown SQL, wrong DB identity, active test, broken prior schema and failed postcheck cannot be accepted", async () => {
  for (const mutate of [f => { f.state.identity[0].databaseName = "wrong"; }, f => { f.state.snapshot.activeTestCount = 1; },
    f => { f.state.snapshot.indexes.pop(); }]) {
    const f = database(); mutate(f); assert.equal((await runCatalogueTestHourMigration({ ...f.options, mode: "apply" })).ok, false);
    assert.equal(f.calls.deployments, 0);
  }
  const badPost = database();
  assert.equal((await runCatalogueTestHourMigration({ ...badPost.options, mode: "apply", deploy: async () => {
    badPost.calls.deployments++; badPost.state.snapshot = snapshot(true); badPost.state.snapshot.constraints[0].validated = false;
  } })).ok, false);
  assert.equal(badPost.calls.deployments, 1);
  const file = path.join(root, "prisma/migrations", NEW, "migration.sql"), original = await readFile(file);
  try {
    await writeFile(file, Buffer.concat([original, Buffer.from("\n-- unreviewed\n")]));
    const f = database(); assert.equal((await runCatalogueTestHourMigration(f.options)).code, "MIGRATION_CATALOG_CHANGED");
    assert.equal(f.calls.connections, 0);
  } finally { await writeFile(file, original); }
});

test("unsafe schema configs and secrets in driver errors never reach deploy or output", async () => {
  const schema = path.join(root, "prisma/schema.prisma"), original = await readFile(schema);
  try {
    await writeFile(schema, original.toString("utf8").replace('env("DATABASE_URL")', 'env("OTHER_URL")'));
    const f = database(); assert.equal((await runCatalogueTestHourMigration(f.options)).code, "MIGRATION_SCHEMA_CONFIGURATION_CHANGED");
    assert.equal(f.calls.connections, 0);
  } finally { await writeFile(schema, original); }
  const f = database();
  assert.deepEqual(await runCatalogueTestHourMigration({ ...f.options, mode: "apply", deploy: () => { throw new Error("postgresql://secret"); } }),
    { ok: false, code: "MIGRATION_GUARD_FAILED" });
  f.db.$disconnect = async () => { throw new Error("credentials"); };
  assert.equal((await runCatalogueTestHourMigration(f.options)).code, "MIGRATION_CLEANUP_UNVERIFIED");
});

test("unresponsive deploy is unconfirmed, bounded and never automatically retried", async () => {
  let now = 0, sequence = 0;
  const timers = new Map();
  const clock = { setTimeout(fn, ms) { const key = ++sequence; timers.set(key, { at: now + ms, fn }); return key; },
    clearTimeout(key) { timers.delete(key); }, async advance(ms) {
      now += ms;
      for (const [key, timer] of [...timers].filter(([, timer]) => timer.at <= now)) {
        timers.delete(key); timer.fn(); for (let i = 0; i < 30; i++) await Promise.resolve();
      }
    } };
  const f = database(); let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const running = runCatalogueTestHourMigration({ ...f.options, mode: "apply", clock, deploy: () => {
    f.calls.deployments++; entered(); return new Promise(() => {});
  } });
  await ready; await clock.advance(130000);
  assert.deepEqual(await running, { ok: false, code: "MIGRATION_APPLY_UNCONFIRMED" });
  assert.equal(f.calls.deployments, 1); assert.equal(f.calls.disconnects, 1);
});

test("migration is transactional and changes only the two existing checks, with no data or history rewrite", async () => {
  const sql = await readFile(new URL(`../prisma/migrations/${NEW}/migration.sql`, import.meta.url), "utf8");
  assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/); assert.match(sql, /SET LOCAL statement_timeout = '30s'/);
  assert.equal((sql.match(/DROP CONSTRAINT/g) || []).length, 2);
  assert.equal((sql.match(/ADD CONSTRAINT/g) || []).length, 2);
  assert.equal((sql.match(/IS TRUE/g) || []).length, 2);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE|TRUNCATE|INSERT INTO|DROP TABLE|DROP INDEX|_prisma_migrations)\b/);
  const runner = await readFile(new URL("../scripts/catalogue-test-hour-migrate.mjs", import.meta.url), "utf8");
  assert.match(runner, /\[executable, "migrate", "deploy", "--schema"/);
  assert.match(runner, /shell: false, windowsHide: true, stdio: "ignore"/);
  assert.doesNotMatch(runner, /"migrate", "(?:reset|resolve|dev)"|"db", "seed"/);
});
