// Opt-in release guard: imports, builds and default CLI execution are read-only.
// Only the two additive columns can be pending; no account is enabled by this script.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { readPreviewMigrationCatalog, PREVIEW_ACCESS_MIGRATION, PREVIEW_ACCESS_MIGRATION_CHECKSUM } from "./private-preview-access-migrate.mjs";
import { catalogueTestMigrationMode, catalogueTestMigrationPreflight, catalogueTestHistoryDigest,
  CATALOGUE_TEST_MIGRATION, CATALOGUE_TEST_MIGRATION_CHECKSUM, CATALOGUE_TEST_PRIOR_HISTORY_DIGEST } from "./catalogue-test-migrate.mjs";
import { CATALOGUE_TEST_HOUR_MIGRATION, CATALOGUE_TEST_HOUR_MIGRATION_CHECKSUM } from "./catalogue-test-hour-migrate.mjs";

export const SUBSCRIBER_TESTING_MIGRATION = "20261208000000_private_preview_subscriber_testing";
export const SUBSCRIBER_TESTING_MIGRATION_CHECKSUM = "8187e1c2e9c2496142e964d708cc9bad4406212fb0afa94ab1c8abc3bd65736d";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."), REQUIRE = createRequire(import.meta.url);
const HASH = /^[a-f0-9]{64}$/, NAME = /^\d{14}_[a-z0-9_]+$/;
const PINNED = new Map([[PREVIEW_ACCESS_MIGRATION, PREVIEW_ACCESS_MIGRATION_CHECKSUM],
  [CATALOGUE_TEST_MIGRATION, CATALOGUE_TEST_MIGRATION_CHECKSUM], [CATALOGUE_TEST_HOUR_MIGRATION, CATALOGUE_TEST_HOUR_MIGRATION_CHECKSUM],
  [SUBSCRIBER_TESTING_MIGRATION, SUBSCRIBER_TESTING_MIGRATION_CHECKSUM]]);
const SAFE = new Set(["MIGRATION_ARGUMENTS_INVALID", "MIGRATION_CATALOG_CHANGED", "MIGRATION_HISTORY_INVALID",
  "MIGRATION_HISTORY_UNKNOWN", "MIGRATION_HISTORY_DUPLICATE", "MIGRATION_HISTORY_UNFINISHED", "MIGRATION_HISTORICAL_FILE_CHANGED",
  "MIGRATION_PRIOR_BASELINE_CHANGED", "MIGRATION_OTHER_PENDING", "MIGRATION_TARGET_SCHEMA_INVALID", "MIGRATION_TARGET_ALREADY_EXISTS",
  "MIGRATION_IDENTITY_MISMATCH", "MIGRATION_SCHEMA_CONFIGURATION_CHANGED", "MIGRATION_PREFLIGHT_CHANGED", "MIGRATION_FILES_CHANGED",
  "MIGRATION_STATE_CHANGED", "MIGRATION_DEPLOY_FAILED", "MIGRATION_APPLY_UNCONFIRMED", "MIGRATION_OPERATION_TIMEOUT",
  "MIGRATION_POSTCHECK_FAILED"]);
const hash = value => createHash("sha256").update(value).digest("hex");
const refusal = code => ({ ok: false, code });
const fail = code => { throw Object.assign(new Error(code), { code }); };

function checkedCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length !== 131 || new Set(catalog.map(row => row?.name)).size !== 131 ||
    catalog.some(row => !NAME.test(row?.name || "") || !HASH.test(row?.checksum || "") ||
      [row.checksumLF, row.checksumCRLF].some(value => value !== undefined && !HASH.test(value))) ||
    catalog.map(row => row.name).sort().at(-1) !== SUBSCRIBER_TESTING_MIGRATION) fail("MIGRATION_CATALOG_CHANGED");
  const files = new Map(catalog.map(row => [row.name, row]));
  for (const [name, pinned] of PINNED) {
    const file = files.get(name);
    if (!file || (name === SUBSCRIBER_TESTING_MIGRATION ? file.checksum !== pinned :
      ![file.checksum, file.checksumLF, file.checksumCRLF].includes(pinned))) fail("MIGRATION_CATALOG_CHANGED");
  }
  return files;
}

export function decideSubscriberTestingMigration(catalog, snapshot) {
  try {
    const files = checkedCatalog(catalog);
    if (!Array.isArray(snapshot?.history) || ![130, 131].includes(snapshot.history.length)) fail("MIGRATION_HISTORY_INVALID");
    const seen = new Set(), baseline = [];
    let historicalLineEndingVariantCount = 0;
    for (const row of snapshot.history) {
      if (!files.has(row?.migration_name)) fail("MIGRATION_HISTORY_UNKNOWN");
      if (seen.has(row.migration_name)) fail("MIGRATION_HISTORY_DUPLICATE");
      seen.add(row.migration_name);
      if (!(row.finished_at instanceof Date) || !Number.isFinite(row.finished_at.getTime()) || row.rolled_back_at !== null ||
        !HASH.test(row.checksum || "")) fail("MIGRATION_HISTORY_UNFINISHED");
      const file = files.get(row.migration_name), pinned = PINNED.get(row.migration_name);
      if (pinned && row.checksum !== pinned || !pinned && ![file.checksum, file.checksumLF, file.checksumCRLF].includes(row.checksum))
        fail("MIGRATION_HISTORICAL_FILE_CHANGED");
      if (row.checksum !== file.checksum) historicalLineEndingVariantCount++;
      if (![CATALOGUE_TEST_MIGRATION, CATALOGUE_TEST_HOUR_MIGRATION, SUBSCRIBER_TESTING_MIGRATION].includes(row.migration_name)) baseline.push(row);
    }
    if (baseline.length !== 128 || catalogueTestHistoryDigest(baseline) !== CATALOGUE_TEST_PRIOR_HISTORY_DIGEST ||
      !seen.has(CATALOGUE_TEST_MIGRATION) || !seen.has(CATALOGUE_TEST_HOUR_MIGRATION)) fail("MIGRATION_PRIOR_BASELINE_CHANGED");
    const applied = seen.has(SUBSCRIBER_TESTING_MIGRATION), pending = [...files.keys()].filter(name => !seen.has(name));
    if (applied ? pending.length !== 0 : pending.length !== 1 || pending[0] !== SUBSCRIBER_TESTING_MIGRATION) fail("MIGRATION_OTHER_PENDING");
    if (!Array.isArray(snapshot.tables) || snapshot.tables.length !== 2 ||
      !["PrivatePreviewAccess", "Subscription"].every(name => snapshot.tables.some(row => row.tableName === name && row.kind === "r")) ||
      !Array.isArray(snapshot.columns)) fail("MIGRATION_TARGET_SCHEMA_INVALID");
    if (!applied && snapshot.columns.length) fail("MIGRATION_TARGET_ALREADY_EXISTS");
    if (applied) {
      const expected = [
        { tableName: "PrivatePreviewAccess", columnName: "subscriberTestingEnabled", dataType: "boolean", nullable: "NO", defaultValue: "false", identity: "NO", generated: "NEVER" },
        { tableName: "Subscription", columnName: "subscriberTestPlanSnapshot", dataType: "jsonb", nullable: "YES", defaultValue: null, identity: "NO", generated: "NEVER" }
      ];
      if (snapshot.columns.length !== 2 || expected.some(column => snapshot.columns.filter(row =>
        Object.entries(column).every(([key, value]) => row[key] === value)).length !== 1)) fail("MIGRATION_TARGET_SCHEMA_INVALID");
    }
    return { ok: true, action: applied ? "ALREADY_APPLIED" : "APPLY", verifiedPriorMigrationCount: 130, historicalLineEndingVariantCount };
  } catch (error) { return refusal(SAFE.has(error?.code) ? error.code : "MIGRATION_HISTORY_INVALID"); }
}

async function schemaConfiguration(root) {
  const [schema, lock, entries] = await Promise.all([readFile(resolve(root, "prisma/schema.prisma"), "utf8"),
    readFile(resolve(root, "prisma/migrations/migration_lock.toml"), "utf8"), readdir(root)]);
  if ((schema.match(/\bdatasource\s+\w+\s*\{/g) || []).length !== 1 ||
    !/\bdatasource\s+db\s*\{\s*provider\s*=\s*"postgresql"\s*url\s*=\s*env\("DATABASE_URL"\)\s*\}/.test(schema) ||
    !/^\s*provider\s*=\s*"postgresql"\s*$/m.test(lock) || entries.some(name => /^prisma\.config\./.test(name))) fail("MIGRATION_SCHEMA_CONFIGURATION_CHANGED");
  return hash(schema + "\0" + lock);
}
async function databaseFactory(url) {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}
async function readSnapshot(db) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const identity = await tx.$queryRaw`SELECT current_database() AS "databaseName", current_schema() AS "schemaName"`;
    if (identity.length !== 1 || identity[0].databaseName !== "ruvanas_private_preview_20261011" || identity[0].schemaName !== "public") fail("MIGRATION_IDENTITY_MISMATCH");
    const history = await tx.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
    const tables = await tx.$queryRaw`SELECT c.relname AS "tableName", c.relkind::text AS "kind" FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('PrivatePreviewAccess', 'Subscription') ORDER BY c.relname`;
    const columns = await tx.$queryRaw`SELECT table_name AS "tableName", column_name AS "columnName", data_type AS "dataType", is_nullable AS "nullable", column_default AS "defaultValue", is_identity AS "identity", is_generated AS "generated" FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'PrivatePreviewAccess' AND column_name = 'subscriberTestingEnabled') OR (table_name = 'Subscription' AND column_name = 'subscriberTestPlanSnapshot')) ORDER BY table_name, column_name`;
    return { history, tables, columns };
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 });
}

function deployOfficial({ root, env }) {
  const executable = REQUIRE.resolve("prisma/build/index.js");
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [executable, "migrate", "deploy", "--schema", resolve(root, "prisma", "schema.prisma")],
      { cwd: root, env, shell: false, windowsHide: true, stdio: "ignore" });
    let timedOut = false, killTimer, confirmationTimer, settled = false;
    const settle = code => {
      if (settled) return;
      settled = true; clearTimeout(timeout); clearTimeout(killTimer); clearTimeout(confirmationTimer);
      code ? reject(Object.assign(new Error(code), { code })) : resolveResult();
    };
    const kill = signal => { try { child.kill(signal); } catch { /* Only close confirms child termination. */ } };
    const timeout = setTimeout(() => {
      timedOut = true; kill("SIGTERM"); killTimer = setTimeout(() => kill("SIGKILL"), 2000);
      confirmationTimer = setTimeout(() => settle("MIGRATION_APPLY_UNCONFIRMED"), 6000);
    }, 120000);
    child.on("error", () => { if (child.pid == null) settle("MIGRATION_DEPLOY_FAILED"); });
    child.once("close", code => settle(timedOut ? "MIGRATION_APPLY_UNCONFIRMED" : code === 0 ? null : "MIGRATION_DEPLOY_FAILED"));
  });
}

export async function runSubscriberTestingMigration({ mode = "check", env = process.env, root = ROOT,
  connect = databaseFactory, deploy = deployOfficial, clock = { setTimeout, clearTimeout } } = {}) {
  if (!["check", "apply"].includes(mode)) return refusal("MIGRATION_ARGUMENTS_INVALID");
  const policy = catalogueTestMigrationPreflight(env);
  if (!policy.ok) return policy;
  let db, result;
  const bounded = (operation, ms, late = null) => new Promise((resolveResult, reject) => {
    let settled = false;
    const timer = clock.setTimeout(() => { settled = true; reject(Object.assign(new Error("MIGRATION_OPERATION_TIMEOUT"), { code: "MIGRATION_OPERATION_TIMEOUT" })); }, ms);
    Promise.resolve().then(() => { if (settled) fail("MIGRATION_OPERATION_TIMEOUT"); return operation(); }).then(value => {
      if (settled) { if (late) void Promise.resolve().then(() => late(value)).catch(() => {}); return; }
      settled = true; clock.clearTimeout(timer); resolveResult(value);
    }, error => { if (!settled) { settled = true; clock.clearTimeout(timer); reject(error); } });
  });
  try {
    const catalog = await readPreviewMigrationCatalog(root); checkedCatalog(catalog);
    const configuration = await schemaConfiguration(root);
    db = await bounded(() => connect(env.DATABASE_URL), 10000, value => bounded(() => value.$disconnect(), 5000));
    const before = decideSubscriberTestingMigration(catalog, await bounded(() => readSnapshot(db), 16000));
    if (!before.ok) fail(before.code);
    if (mode === "apply" && before.action === "APPLY") {
      if (!catalogueTestMigrationPreflight(env).ok) fail("MIGRATION_PREFLIGHT_CHANGED");
      if (JSON.stringify(await readPreviewMigrationCatalog(root)) !== JSON.stringify(catalog) || await schemaConfiguration(root) !== configuration) fail("MIGRATION_FILES_CHANGED");
      const fresh = decideSubscriberTestingMigration(catalog, await bounded(() => readSnapshot(db), 16000));
      if (!fresh.ok || fresh.action !== "APPLY") fail(fresh.ok ? "MIGRATION_STATE_CHANGED" : fresh.code);
      try { await bounded(() => deploy({ root, env }), 130000); }
      catch (error) { if (error?.code === "MIGRATION_OPERATION_TIMEOUT") fail("MIGRATION_APPLY_UNCONFIRMED"); throw error; }
      const after = decideSubscriberTestingMigration(catalog, await bounded(() => readSnapshot(db), 16000));
      if (!after.ok || after.action !== "ALREADY_APPLIED") fail(after.ok ? "MIGRATION_POSTCHECK_FAILED" : after.code);
      if (JSON.stringify(await readPreviewMigrationCatalog(root)) !== JSON.stringify(catalog) || await schemaConfiguration(root) !== configuration) fail("MIGRATION_FILES_CHANGED");
      result = { ok: true, status: "APPLIED", migration: SUBSCRIBER_TESTING_MIGRATION, verifiedPriorMigrationCount: 130, accountAccessChanged: false, streamingStarted: false };
    } else result = { ok: true, status: before.action === "ALREADY_APPLIED" ? "ALREADY_APPLIED" : "READY_READ_ONLY",
      migration: SUBSCRIBER_TESTING_MIGRATION, verifiedPriorMigrationCount: 130, accountAccessChanged: false, streamingStarted: false };
  } catch (error) { result = refusal(SAFE.has(error?.code) ? error.code : "MIGRATION_GUARD_FAILED"); }
  finally { if (db) try { await bounded(() => db.$disconnect(), 5000); } catch { result = refusal("MIGRATION_CLEANUP_UNVERIFIED"); } }
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let result;
  try { result = await runSubscriberTestingMigration({ mode: catalogueTestMigrationMode(process.argv.slice(2)) }); }
  catch { result = refusal("MIGRATION_ARGUMENTS_INVALID"); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
