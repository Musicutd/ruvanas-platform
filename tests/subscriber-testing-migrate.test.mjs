import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPreviewMigrationCatalog, PREVIEW_ACCESS_MIGRATION, PREVIEW_ACCESS_MIGRATION_CHECKSUM } from "../scripts/private-preview-access-migrate.mjs";
import { CATALOGUE_TEST_MIGRATION, CATALOGUE_TEST_MIGRATION_CHECKSUM } from "../scripts/catalogue-test-migrate.mjs";
import { CATALOGUE_TEST_HOUR_MIGRATION, CATALOGUE_TEST_HOUR_MIGRATION_CHECKSUM } from "../scripts/catalogue-test-hour-migrate.mjs";
import { SUBSCRIBER_TESTING_MIGRATION as NEW, SUBSCRIBER_TESTING_MIGRATION_CHECKSUM as HASH,
  decideSubscriberTestingMigration, runSubscriberTestingMigration, subscriberTestingMigrationPreflight } from "../scripts/subscriber-testing-migrate.mjs";

const ENV = { NODE_ENV: "production", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW", RENDER_SERVICE_ID: "srv-da03b5lbedkc739q74k0",
  RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
  RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test",
  RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
  DATABASE_URL: "postgresql://synthetic:never-print-this@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011?schema=public" };
const clone = structuredClone, row = (name, checksum) => ({ migration_name: name, checksum, finished_at: new Date("2026-10-23T00:00:00Z"), rolled_back_at: null });
let root, catalog, prior;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ruvanas-subscriber-migrate-"));
  // This historical one-release guard intentionally rejects later migrations.
  // Its successful fixtures must contain only the release inventory it pinned.
  for (const entry of (await readPreviewMigrationCatalog()).filter(entry => entry.name <= NEW)) {
    const directory = path.join(root, "prisma/migrations", entry.name); await mkdir(directory, { recursive: true });
    await copyFile(new URL(`../prisma/migrations/${entry.name}/migration.sql`, import.meta.url), path.join(directory, "migration.sql"));
  }
  await copyFile(new URL("../prisma/schema.prisma", import.meta.url), path.join(root, "prisma/schema.prisma"));
  await copyFile(new URL("../prisma/migrations/migration_lock.toml", import.meta.url), path.join(root, "prisma/migrations/migration_lock.toml"));
  catalog = await readPreviewMigrationCatalog(root);
  assert.equal(catalog.length, 131); assert.equal(catalog.find(entry => entry.name === NEW).checksum, HASH);
  const pinned = new Map([[PREVIEW_ACCESS_MIGRATION, PREVIEW_ACCESS_MIGRATION_CHECKSUM],
    [CATALOGUE_TEST_MIGRATION, CATALOGUE_TEST_MIGRATION_CHECKSUM], [CATALOGUE_TEST_HOUR_MIGRATION, CATALOGUE_TEST_HOUR_MIGRATION_CHECKSUM]]);
  prior = catalog.filter(entry => entry.name !== NEW).map(entry => row(entry.name, pinned.get(entry.name) || entry.checksumCRLF || entry.checksum));
});
after(async () => {
  if (root && path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("ruvanas-subscriber-migrate-")) await rm(root, { recursive: true, force: true });
});
function snapshot(applied = false) {
  return { history: clone(applied ? [...prior, row(NEW, HASH)] : prior),
    tables: ["PrivatePreviewAccess", "Subscription"].map(tableName => ({ tableName, kind: "r" })),
    columns: applied ? [
      { tableName: "PrivatePreviewAccess", columnName: "subscriberTestingEnabled", dataType: "boolean", nullable: "NO", defaultValue: "false", identity: "NO", generated: "NEVER" },
      { tableName: "Subscription", columnName: "subscriberTestPlanSnapshot", dataType: "jsonb", nullable: "YES", defaultValue: null, identity: "NO", generated: "NEVER" }
    ] : [] };
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
          sql.includes("information_schema.columns") ? state.snapshot.columns : state.snapshot.tables);
      } });
  }, async $disconnect() { calls.disconnects++; } };
  return { state, calls, db, options: { env: clone(ENV), root, connect: async () => { calls.connections++; return db; },
    deploy: async () => { calls.deployments++; state.snapshot = snapshot(true); } } };
}

test("the historical apply guard refuses the later Retail migration without connecting or deploying", async () => {
  const currentCatalog = await readPreviewMigrationCatalog();
  assert.ok(currentCatalog.some(entry => entry.name === "20261209000000_retail_focused_catalogue_audio_only"));
  assert.equal(decideSubscriberTestingMigration(currentCatalog, snapshot()).code, "MIGRATION_CATALOG_CHANGED");
  const f = database();
  const result = await runSubscriberTestingMigration({ ...f.options, mode: "apply",
    root: fileURLToPath(new URL("../", import.meta.url)) });
  assert.equal(result.code, "MIGRATION_CATALOG_CHANGED");
  assert.equal(f.calls.connections, 0); assert.equal(f.calls.deployments, 0);
});

test("exact 130-row history permits only the pinned additive migration and verified historical EOL variants", () => {
  const decision = decideSubscriberTestingMigration(catalog, snapshot()); assert.equal(decision.action, "APPLY");
  assert.equal(decision.verifiedPriorMigrationCount, 130);
  assert.equal(decideSubscriberTestingMigration(catalog, snapshot(true)).action, "ALREADY_APPLIED");
  for (const mutate of [s => s.history.pop(), s => s.history.push(row("20261209000000_unknown", "a".repeat(64))),
    s => s.history[0].checksum = "a".repeat(64), s => s.history[0].finished_at = null,
    s => s.history[1] = clone(s.history[0]), s => s.history[0].rolled_back_at = new Date(),
    s => s.history.find(r => r.migration_name === CATALOGUE_TEST_HOUR_MIGRATION).checksum = "a".repeat(64)]) {
    const s = snapshot(); mutate(s); assert.equal(decideSubscriberTestingMigration(catalog, s).ok, false);
  }
  const changed = clone(catalog); changed.find(row => row.name === NEW).checksum = "a".repeat(64);
  assert.equal(decideSubscriberTestingMigration(changed, snapshot()).code, "MIGRATION_CATALOG_CHANGED");
  const after = snapshot(true); after.history.at(-1).checksum = "a".repeat(64);
  assert.equal(decideSubscriberTestingMigration(catalog, after).ok, false);
});

test("partial columns, weakened defaults, wrong types or missing original tables fail closed", () => {
  const partial = snapshot(); partial.columns.push(snapshot(true).columns[0]);
  assert.equal(decideSubscriberTestingMigration(catalog, partial).code, "MIGRATION_TARGET_ALREADY_EXISTS");
  for (const mutate of [s => s.columns.pop(), s => s.tables.pop(), s => s.tables[0].kind = "v",
    s => s.columns[0].defaultValue = "true", s => s.columns[0].nullable = "YES",
    s => s.columns[1].defaultValue = "'{}'::jsonb", s => s.columns[1].dataType = "json",
    s => s.columns[1].generated = "ALWAYS"]) {
    const s = snapshot(true); mutate(s); assert.equal(decideSubscriberTestingMigration(catalog, s).ok, false);
  }
});

test("default check is read-only; apply rechecks, deploys once, postverifies and is idempotent", async () => {
  const check = database(); assert.equal((await runSubscriberTestingMigration(check.options)).status, "READY_READ_ONLY");
  assert.equal(check.calls.deployments, 0); assert.equal(check.calls.readonly, 1); assert.equal(check.calls.disconnects, 1);
  const f = database(), history = clone(f.state.snapshot.history);
  assert.deepEqual(await runSubscriberTestingMigration({ ...f.options, mode: "apply" }), {
    ok: true, status: "APPLIED", migration: NEW, verifiedPriorMigrationCount: 130, accountAccessChanged: false, streamingStarted: false });
  assert.equal(f.calls.deployments, 1); assert.equal(f.calls.readonly, 3); assert.deepEqual(f.state.snapshot.history.slice(0, 130), history);
  assert.equal((await runSubscriberTestingMigration({ ...f.options, mode: "apply" })).status, "ALREADY_APPLIED");
  assert.equal(f.calls.deployments, 1);
});

test("host, closed registration, database and TLS are checked before connecting", async () => {
  for (const patch of [{ RENDER_SERVICE_ID: "retail-worker" }, { RUVANAS_PUBLIC_URL: "https://other.example" },
    { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { DATABASE_URL: ENV.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "other.example") }]) {
    const f = database(), result = await runSubscriberTestingMigration({ ...f.options, env: { ...ENV, ...patch }, mode: "apply" });
    assert.equal(result.ok, false); assert.equal(f.calls.connections, 0); assert.equal(f.calls.deployments, 0);
    assert.doesNotMatch(JSON.stringify(result), /never-print-this|postgresql/);
  }
});

test("the additive website migration permits existing live flags without changing them and rejects both encoder hosts", async () => {
  const env = { ...ENV, RUVANAS_CATALOGUE_TEST_START_ENABLED: "true", RUVANAS_CATALOGUE_TEST_ALLOW_LIVE: "true",
    RUVANAS_AUTODJ_ALLOW_LIVE: "true", RUVANAS_AUTODJ_TIMED_OUTPUT_ACCEPTED: "true" };
  const unchanged = clone(env);
  assert.deepEqual(subscriberTestingMigrationPreflight(env), { ok: true });
  const f = database();
  assert.equal((await runSubscriberTestingMigration({ ...f.options, env, mode: "apply" })).status, "APPLIED");
  assert.equal(f.calls.deployments, 1); assert.deepEqual(env, unchanged);
  for (const service of ["srv-damhnbv40ujc73b00lgg", "srv-dbeoq2vb9u1s73aeom1g", "another-web-service"]) {
    const worker = database();
    const result = await runSubscriberTestingMigration({ ...worker.options, env: { ...env, RENDER_SERVICE_ID: service }, mode: "apply" });
    assert.equal(result.code, "MIGRATION_HOST_REQUIRED"); assert.equal(worker.calls.connections, 0); assert.equal(worker.calls.deployments, 0);
  }
  for (const patch of [{ DATABASE_URL: env.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "foreign.example") },
    { DATABASE_URL: env.DATABASE_URL + "&sslmode=disable" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" }, { RENDER_SERVICE_ID: undefined }]) {
    const denied = database();
    assert.equal((await runSubscriberTestingMigration({ ...denied.options, env: { ...env, ...patch }, mode: "apply" })).ok, false);
    assert.equal(denied.calls.connections, 0); assert.equal(denied.calls.deployments, 0);
  }
});

test("wrong live identity, failed deploy or unchanged postcheck cannot be reported successful", async () => {
  const identity = database(); identity.state.identity[0].schemaName = "other";
  assert.equal((await runSubscriberTestingMigration({ ...identity.options, mode: "apply" })).code, "MIGRATION_IDENTITY_MISMATCH");
  assert.equal(identity.calls.deployments, 0);
  const f = database(); assert.equal((await runSubscriberTestingMigration({ ...f.options, mode: "apply", deploy: async () => {} })).code, "MIGRATION_POSTCHECK_FAILED");
  assert.deepEqual(await runSubscriberTestingMigration({ ...f.options, mode: "apply", deploy: async () => { throw Error("postgresql://private"); } }), { ok: false, code: "MIGRATION_GUARD_FAILED" });
});

test("new SQL is pinned before a connection and the schema cannot redirect the official CLI", async () => {
  for (const [file, mutate, code] of [
    [path.join(root, "prisma/migrations", NEW, "migration.sql"), value => value + "\n-- changed", "MIGRATION_CATALOG_CHANGED"],
    [path.join(root, "prisma/schema.prisma"), value => value.replace('env("DATABASE_URL")', 'env("OTHER_URL")'), "MIGRATION_SCHEMA_CONFIGURATION_CHANGED"]
  ]) {
    const original = await readFile(file);
    try { await writeFile(file, mutate(original.toString("utf8"))); const f = database();
      assert.equal((await runSubscriberTestingMigration(f.options)).code, code); assert.equal(f.calls.connections, 0);
    } finally { await writeFile(file, original); }
  }
});

test("new migration is transactional, timeout-bounded and never updates users, plans or history", async () => {
  const sql = await readFile(new URL(`../prisma/migrations/${NEW}/migration.sql`, import.meta.url), "utf8");
  assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;/); assert.match(sql, /lock_timeout = '5s'/); assert.match(sql, /statement_timeout = '30s'/);
  assert.equal((sql.match(/ALTER TABLE/g) || []).length, 2); assert.equal((sql.match(/ADD COLUMN/g) || []).length, 2);
  assert.match(sql, /BOOLEAN NOT NULL DEFAULT false/); assert.match(sql, /"subscriberTestPlanSnapshot" JSONB;/);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE|TRUNCATE|INSERT INTO|DROP TABLE|_prisma_migrations)\b/);
  const runner = await readFile(new URL("../scripts/subscriber-testing-migrate.mjs", import.meta.url), "utf8");
  assert.match(runner, /\[executable, "migrate", "deploy", "--schema"/);
  assert.doesNotMatch(runner, /"migrate", "(?:reset|resolve|dev)"|"db", "seed"/);
});
