import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPreviewMigrationCatalog, PREVIEW_ACCESS_MIGRATION } from "../scripts/private-preview-access-migrate.mjs";
import { CATALOGUE_TEST_MIGRATION as NEW, CATALOGUE_TEST_MIGRATION_CHECKSUM as CHECKSUM,
  CATALOGUE_TEST_PRIOR_HISTORY_DIGEST as DIGEST, catalogueTestHistoryDigest, catalogueTestMigrationMode,
  catalogueTestMigrationPreflight, decideCatalogueTestMigration, runCatalogueTestMigration } from "../scripts/catalogue-test-migrate.mjs";

const ENV = { NODE_ENV: "production", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW", RENDER_SERVICE_ID: "srv-da03b5lbedkc739q74k0",
  RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
  RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test",
  RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
  DATABASE_URL: "postgresql://synthetic:never-print-this@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011?schema=public" };
const row = entry => ({ migration_name: entry.name, checksum: entry.checksum, finished_at: new Date("2026-10-15T00:00:00Z"), rolled_back_at: null });
const clone = value => structuredClone(value);
let root, catalog, prior;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ruvanas-catalogue-migrate-tests-"));
  const actual = await readPreviewMigrationCatalog();
  for (const entry of actual) {
    const directory = path.join(root, "prisma/migrations", entry.name);
    await mkdir(directory, { recursive: true });
    const source = fileURLToPath(new URL(`../prisma/migrations/${entry.name}/migration.sql`, import.meta.url));
    // Fixtures preserve every historical byte. Only the NEW fixture uses its
    // explicitly reviewed LF bytes; the real-file preflight never normalizes.
    if (entry.name === NEW) await writeFile(path.join(directory, "migration.sql"), (await readFile(source, "utf8")).replace(/\r\n/g, "\n"));
    else await copyFile(source, path.join(directory, "migration.sql"));
  }
  await copyFile(new URL("../prisma/schema.prisma", import.meta.url), path.join(root, "prisma/schema.prisma"));
  await copyFile(new URL("../prisma/migrations/migration_lock.toml", import.meta.url), path.join(root, "prisma/migrations/migration_lock.toml"));
  catalog = await readPreviewMigrationCatalog(root);
  assert.equal(catalog.find(entry => entry.name === NEW).checksum, CHECKSUM);
  prior = catalog.filter(entry => entry.name !== NEW).map(entry => row({ ...entry,
    checksum: entry.name === PREVIEW_ACCESS_MIGRATION ? entry.checksum : entry.checksumCRLF || entry.checksum }));
  assert.equal(prior.length, 128);
  assert.equal(catalogueTestHistoryDigest(prior), DIGEST);
});
after(async () => {
  if (root && path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("ruvanas-catalogue-migrate-tests-")) await rm(root, { recursive: true, force: true });
});

function appliedSchema() {
  const table = "OnlineRadioCatalogueTest", event = "OnlineRadioCatalogueTestEvent";
  const index = (tableName, indexName, unique, columns, predicate = null) => ({ tableName, indexName, unique, columns, predicate, valid: true, ready: true, method: "btree" });
  return { tables: [{ tableName: table, kind: "r" }, { tableName: event, kind: "r" }], indexes: [
    index(table, `${table}_pkey`, true, ["id"]), index(table, `${table}_stationId_status_createdAt_idx`, false, ["stationId", "status", "createdAt"]),
    index(table, `${table}_status_expiresAt_idx`, false, ["status", "expiresAt"]),
    index(table, "catalogue_test_one_active_per_station", true, ["stationId"], "(status = ANY (ARRAY['ARMED'::text, 'RUNNING'::text]))"),
    index(event, `${event}_pkey`, true, ["id"]), index(event, `${event}_testId_eventKey_key`, true, ["testId", "eventKey"]),
    index(event, `${event}_testId_occurredAt_idx`, false, ["testId", "occurredAt"]) ] };
}
function snapshot(applied = false) {
  return { history: clone(applied ? [...prior, row({ name: NEW, checksum: CHECKSUM })] : prior),
    ...(applied ? appliedSchema() : { tables: [], indexes: [] }) };
}
function database(initial = snapshot()) {
  const state = { snapshot: initial, identity: [{ databaseName: "ruvanas_private_preview_20261011", schemaName: "public" }] };
  const calls = { connections: 0, deployments: 0, disconnects: 0, readonly: 0, queries: 0, transactions: [] };
  const db = { async $transaction(operation, options) {
    calls.transactions.push(options);
    return operation({ async $executeRaw(strings) { assert.equal(strings.join(""), "SET TRANSACTION READ ONLY"); calls.readonly++; },
      async $queryRaw(strings) { calls.queries++;
        const sql = strings.join("");
        return clone(sql.includes("current_database()") ? state.identity : sql.includes('"_prisma_migrations"') ? state.snapshot.history :
          sql.includes("FROM pg_catalog.pg_index") ? state.snapshot.indexes : state.snapshot.tables);
      } });
  }, async $disconnect() { calls.disconnects++; } };
  const options = { env: clone(ENV), root, connect: async () => { calls.connections++; return db; },
    deploy: async () => { calls.deployments++; state.snapshot = snapshot(true); } };
  return { db, state, calls, options };
}
function fakeClock() {
  let now = 0, id = 0;
  const timers = new Map();
  return { setTimeout(fn, milliseconds) { const key = ++id; timers.set(key, { at: now + milliseconds, fn }); return key; },
    clearTimeout(key) { timers.delete(key); },
    async advance(milliseconds) { now += milliseconds;
      for (const [key, timer] of [...timers].filter(([, entry]) => entry.at <= now).sort((a, b) => a[1].at - b[1].at)) {
        timers.delete(key); timer.fn();
        for (let n = 0; n < 30; n++) await Promise.resolve();
      }
    } };
}

test("default and --check are read-only; only standalone --apply requests a migration", () => {
  assert.equal(catalogueTestMigrationMode(), "check"); assert.equal(catalogueTestMigrationMode(["--check"]), "check");
  assert.equal(catalogueTestMigrationMode(["--apply"]), "apply");
  for (const args of [["--apply", "--check"], ["--apply", "--force"], ["--live"], ["--schema", "other"]]) assert.throws(() => catalogueTestMigrationMode(args));
});

test("preflight pins existing host, canonical URL, preview policy and exact internal DB without TLS relaxation", () => {
  assert.deepEqual(catalogueTestMigrationPreflight(ENV), { ok: true });
  for (const patch of [{ RENDER_SERVICE_ID: "wrong" }, { RUVANAS_ENVIRONMENT: "PRODUCTION" }, { RUVANAS_PUBLIC_URL: "https://ruvanas-platform.onrender.com" },
    { RUVANAS_PUBLIC_URL: "https://www.ruvanas.com/" }, { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" },
    { RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "different@example.test" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { PGSSLMODE: "disable" },
    { DATABASE_URL: ENV.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "external.example") },
    { DATABASE_URL: ENV.DATABASE_URL.replace("ruvanas_private_preview_20261011", "other") },
    { DATABASE_URL: ENV.DATABASE_URL + "&sslmode=disable" }, { DATABASE_URL: ENV.DATABASE_URL + "&sslaccept=accept_invalid_certs" },
    { DATABASE_URL: ENV.DATABASE_URL + "&schema=public" }, { DATABASE_URL: ENV.DATABASE_URL + "&options=unapproved" },
    { DATABASE_URL: ENV.DATABASE_URL.replace("schema=public", "schema=private") }]) {
    const result = catalogueTestMigrationPreflight({ ...ENV, ...patch });
    assert.equal(result.ok, false, JSON.stringify(patch)); assert.doesNotMatch(JSON.stringify(result), /never-print-this|postgresql/);
  }
  for (const key of ["RUVANAS_CATALOGUE_TEST_START_ENABLED", "RUVANAS_CATALOGUE_TEST_ALLOW_LIVE", "RUVANAS_AUTODJ_ALLOW_LIVE", "RUVANAS_AUTODJ_TIMED_OUTPUT_ACCEPTED"]) {
    assert.equal(catalogueTestMigrationPreflight({ ...ENV, [key]: "true" }).code, "MIGRATION_OUTPUT_GATES_MUST_BE_OFF");
    assert.equal(catalogueTestMigrationPreflight({ ...ENV, [key]: "false" }).ok, true);
  }
});

test("all 128 exact observed checksums are pinned while unchanged mixed-EOL files match raw first", () => {
  const lfCheckout = catalog.map(entry => entry.name !== NEW && entry.checksumLF ? { ...entry, checksum: entry.checksumLF } : entry);
  const result = decideCatalogueTestMigration(lfCheckout, snapshot());
  assert.equal(result.action, "APPLY"); assert.equal(result.historicalLineEndingVariantCount, 106);
  const mixed = catalog.find(entry => entry.name === "20260824190000_initial_schema");
  assert.equal(mixed.checksumLF, undefined); assert.equal(prior.find(record => record.migration_name === mixed.name).checksum, mixed.checksum);
  assert.equal(catalogueTestHistoryDigest([...prior].reverse()), DIGEST);
});

test("unknown, duplicate, unfinished, changed or non-baseline history cannot deploy", () => {
  for (const mutate of [s => { s.history[0].migration_name = "20260101000000_unknown"; }, s => { s.history[0] = clone(s.history[1]); },
    s => { s.history[0].finished_at = null; }, s => { s.history[0].rolled_back_at = new Date(); },
    s => { s.history[0].checksum = "f".repeat(64); }, s => { s.history.pop(); },
    s => { const record = s.history.find(item => { const file = catalog.find(entry => entry.name === item.migration_name); return file.checksumLF && file.checksumLF !== item.checksum; });
      record.checksum = catalog.find(file => file.name === record.migration_name).checksumLF; }]) {
    const s = snapshot(); mutate(s); assert.equal(decideCatalogueTestMigration(catalog, s).ok, false);
  }
  const altered = clone(catalog); altered[0].checksum = "f".repeat(64); delete altered[0].checksumLF; delete altered[0].checksumCRLF;
  assert.equal(decideCatalogueTestMigration(altered, snapshot()).code, "MIGRATION_HISTORICAL_FILE_CHANGED");
});

test("only the exact new migration may be pending; no new-file EOL alternative or extra migration is accepted", () => {
  const changed = clone(catalog); changed.find(entry => entry.name === NEW).checksum = "f".repeat(64);
  assert.equal(decideCatalogueTestMigration(changed, snapshot()).code, "MIGRATION_CATALOG_CHANGED");
  assert.equal(decideCatalogueTestMigration([...catalog, { name: "20261207000000_other", checksum: "a".repeat(64) }], snapshot()).code, "MIGRATION_CATALOG_CHANGED");
  const applied = snapshot(true); applied.history.at(-1).checksum = "f".repeat(64);
  assert.equal(decideCatalogueTestMigration(catalog, applied).code, "MIGRATION_NEW_CHECKSUM_CHANGED");
});

test("target tables must be absent before apply and both tables plus exact ready indexes must exist afterward", () => {
  const exists = snapshot(); exists.tables = appliedSchema().tables;
  assert.equal(decideCatalogueTestMigration(catalog, exists).code, "MIGRATION_TARGET_ALREADY_EXISTS");
  assert.equal(decideCatalogueTestMigration(catalog, snapshot(true)).action, "ALREADY_APPLIED");
  for (const change of [s => s.tables.pop(), s => { s.tables[0].kind = "v"; }, s => s.indexes.pop(),
    s => { s.indexes[0].unique = false; }, s => { s.indexes[0].valid = false; }, s => { s.indexes[0].ready = false; },
    s => { s.indexes[1].columns.reverse(); }, s => { s.indexes[3].predicate = "status = 'FAILED'"; },
    s => { s.indexes[0].method = "hash"; }]) {
    const s = snapshot(true); change(s); assert.equal(decideCatalogueTestMigration(catalog, s).code, "MIGRATION_TARGET_SCHEMA_INVALID");
  }
});

test("default check performs only read-only identity/history/schema queries and cannot invoke deploy", async () => {
  const f = database(); const result = await runCatalogueTestMigration(f.options);
  assert.equal(result.status, "READY_READ_ONLY"); assert.equal(result.streamingStarted, false);
  assert.equal(f.calls.deployments, 0); assert.equal(f.calls.readonly, 1); assert.equal(f.calls.disconnects, 1);
  assert.deepEqual(f.calls.transactions[0], { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 });
});

test("explicit apply rechecks identity and unchanged files/history, deploys once then proves exact new objects", async () => {
  const f = database(); const before = clone(f.state.snapshot.history);
  const result = await runCatalogueTestMigration({ ...f.options, mode: "apply" });
  assert.equal(result.status, "APPLIED"); assert.equal(f.calls.deployments, 1); assert.equal(f.calls.readonly, 3);
  assert.deepEqual(f.state.snapshot.history.slice(0, 128), before);
  assert.equal(f.calls.disconnects, 1); assert.equal(result.streamingStarted, false);
});

test("already applied is idempotent and failed identity/history checks never reach deployment", async () => {
  const applied = database(snapshot(true));
  assert.equal((await runCatalogueTestMigration({ ...applied.options, mode: "apply" })).status, "ALREADY_APPLIED");
  assert.equal(applied.calls.deployments, 0);
  const wrong = database(); wrong.state.identity[0].databaseName = "wrong";
  assert.equal((await runCatalogueTestMigration({ ...wrong.options, mode: "apply" })).code, "MIGRATION_IDENTITY_MISMATCH");
  assert.equal(wrong.calls.deployments, 0); assert.equal(wrong.calls.disconnects, 1);
  const history = database(); history.state.snapshot.history[0].checksum = "a".repeat(64);
  assert.equal((await runCatalogueTestMigration({ ...history.options, mode: "apply" })).ok, false);
  assert.equal(history.calls.deployments, 0);
});

test("invalid environment and changed new SQL are refused before a client is constructed", async () => {
  let connects = 0;
  const connect = () => { connects++; throw new Error("unexpected"); };
  assert.equal((await runCatalogueTestMigration({ env: {}, root, connect })).ok, false);
  const file = path.join(root, "prisma/migrations", NEW, "migration.sql"), original = await readFile(file);
  try {
    await writeFile(file, Buffer.concat([original, Buffer.from("\n-- unreviewed\n")]));
    assert.equal((await runCatalogueTestMigration({ env: ENV, root, connect })).code, "MIGRATION_CATALOG_CHANGED");
  } finally { await writeFile(file, original); }
  assert.equal(connects, 0);
});

test("postcheck detects altered prior history and missing objects without repair or retry", async () => {
  for (const corrupt of [s => { s.history[0].checksum = "f".repeat(64); }, s => { s.indexes.pop(); }]) {
    const f = database();
    const result = await runCatalogueTestMigration({ ...f.options, mode: "apply", deploy: async () => {
      f.calls.deployments++; f.state.snapshot = snapshot(true); corrupt(f.state.snapshot);
    } });
    assert.equal(result.ok, false); assert.equal(f.calls.deployments, 1); assert.equal(f.calls.disconnects, 1);
  }
});

test("driver and cleanup errors return only fixed safe codes, never credential text", async () => {
  const f = database();
  const failed = await runCatalogueTestMigration({ ...f.options, mode: "apply", deploy: () => { throw new Error("postgresql://secret:password@private"); } });
  assert.deepEqual(failed, { ok: false, code: "MIGRATION_GUARD_FAILED" });
  const broken = database(); broken.db.$disconnect = () => { throw new Error("secret details"); };
  const cleanup = await runCatalogueTestMigration(broken.options);
  assert.deepEqual(cleanup, { ok: false, code: "MIGRATION_CLEANUP_UNVERIFIED" });
  assert.doesNotMatch(JSON.stringify([failed, cleanup]), /secret|password|postgresql/);
});

test("connection and read timeouts settle bounded; a late connection is disconnected and never deployed", async () => {
  const f = database(), clock = fakeClock(); let connectEntered, resolveConnection;
  const entered = new Promise(resolve => { connectEntered = resolve; });
  const pending = runCatalogueTestMigration({ ...f.options, clock, connect: () => {
    connectEntered(); return new Promise(resolve => { resolveConnection = resolve; });
  } });
  await entered; await clock.advance(10000);
  assert.equal((await pending).code, "MIGRATION_OPERATION_TIMEOUT");
  assert.equal(f.calls.disconnects, 0); assert.equal(f.calls.deployments, 0);
  resolveConnection(f.db);
  for (let n = 0; n < 30; n++) await Promise.resolve();
  assert.equal(f.calls.disconnects, 1);

  const read = database(), readClock = fakeClock(); let readEntered;
  const reading = new Promise(resolve => { readEntered = resolve; });
  read.db.$transaction = () => { readEntered(); return new Promise(() => {}); };
  const readingResult = runCatalogueTestMigration({ ...read.options, clock: readClock });
  await reading; await readClock.advance(16000);
  assert.equal((await readingResult).code, "MIGRATION_OPERATION_TIMEOUT");
  assert.equal(read.calls.disconnects, 1); assert.equal(read.calls.deployments, 0);
});

test("an unresponsive apply is explicitly unconfirmed and never automatically retried", async () => {
  const f = database(), clock = fakeClock(); let applyEntered;
  const entered = new Promise(resolve => { applyEntered = resolve; });
  const pending = runCatalogueTestMigration({ ...f.options, mode: "apply", clock, deploy: () => {
    f.calls.deployments++; applyEntered(); return new Promise(() => {});
  } });
  await entered; await clock.advance(130000);
  assert.deepEqual(await pending, { ok: false, code: "MIGRATION_APPLY_UNCONFIRMED" });
  assert.equal(f.calls.deployments, 1); assert.equal(f.calls.disconnects, 1);
});

test("the official CLI cannot be redirected through a different schema datasource or auto-loaded config", async () => {
  const schemaFile = path.join(root, "prisma/schema.prisma"), original = await readFile(schemaFile);
  try {
    await writeFile(schemaFile, original.toString("utf8").replace('env("DATABASE_URL")', 'env("OTHER_URL")'));
    const f = database();
    assert.equal((await runCatalogueTestMigration(f.options)).code, "MIGRATION_SCHEMA_CONFIGURATION_CHANGED");
    assert.equal(f.calls.connections, 0);
  } finally { await writeFile(schemaFile, original); }
  const config = path.join(root, "prisma.config.ts");
  try {
    await writeFile(config, "// Synthetic unexpected config, never executed.\n");
    const f = database();
    assert.equal((await runCatalogueTestMigration(f.options)).code, "MIGRATION_SCHEMA_CONFIGURATION_CHANGED");
    assert.equal(f.calls.connections, 0);
  } finally { await rm(config); }
});

test("official subprocess is direct Prisma deploy only, bounded and never a reset, history repair or seed", async () => {
  const source = await readFile(new URL("../scripts/catalogue-test-migrate.mjs", import.meta.url), "utf8");
  assert.match(source, /REQUIRE\.resolve\("prisma\/build\/index\.js"\)/);
  assert.match(source, /spawn\(process\.execPath, \[executable, "migrate", "deploy", "--schema"/);
  assert.match(source, /shell: false, windowsHide: true, stdio: "ignore"/);
  assert.match(source, /120000/); assert.match(source, /SIGKILL/); assert.match(source, /MIGRATION_APPLY_UNCONFIRMED/);
  assert.doesNotMatch(source, /"migrate", "(?:reset|resolve|dev)"|"db", "seed"|UPDATE .*_prisma_migrations|console\.(?:log|error)\(error/);
});
