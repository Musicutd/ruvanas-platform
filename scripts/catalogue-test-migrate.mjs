// Separate one-release guard. Imports/builds never migrate; default CLI is read-only.
// Historical migration files and _prisma_migrations rows are never rewritten.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { readPrivatePreviewPolicy } from "../lib/private-preview-policy.mjs";
import { readPreviewMigrationCatalog, PREVIEW_ACCESS_MIGRATION, PREVIEW_ACCESS_MIGRATION_CHECKSUM } from "./private-preview-access-migrate.mjs";

export const CATALOGUE_TEST_MIGRATION = "20261206000000_online_radio_catalogue_test";
export const CATALOGUE_TEST_MIGRATION_CHECKSUM = "358937448fd49e815aeee96113b40121274b96fb96d6ca21d9c658ffb0b6f90f";
export const CATALOGUE_TEST_PRIOR_HISTORY_DIGEST = "2c372e9b473efbe67a26dc6e24722ee38b03dadbbc83310b1d88267007c91f78";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRE = createRequire(import.meta.url);
const SERVICE = "srv-da03b5lbedkc739q74k0";
const DATABASE_HOST = "dpg-db5kurijnfac73arripg-a";
const DATABASE_NAME = "ruvanas_private_preview_20261011";
const TABLE = "OnlineRadioCatalogueTest", EVENT_TABLE = "OnlineRadioCatalogueTestEvent";
const NAME = /^\d{14}_[a-z0-9_]+$/, HASH = /^[a-f0-9]{64}$/;
const QUERY_KEYS = new Set(["schema", "sslmode", "sslaccept", "connection_limit", "pool_timeout", "connect_timeout"]);
const OFF_GATES = ["RUVANAS_CATALOGUE_TEST_START_ENABLED", "RUVANAS_CATALOGUE_TEST_ALLOW_LIVE",
  "RUVANAS_AUTODJ_ALLOW_LIVE", "RUVANAS_AUTODJ_TIMED_OUTPUT_ACCEPTED"];
const SAFE_ERRORS = new Set(["MIGRATION_ARGUMENTS_INVALID", "MIGRATION_CATALOG_CHANGED", "MIGRATION_TARGET_SCHEMA_INVALID",
  "MIGRATION_TARGET_ALREADY_EXISTS", "MIGRATION_HISTORY_INVALID", "MIGRATION_HISTORY_UNKNOWN", "MIGRATION_HISTORY_DUPLICATE",
  "MIGRATION_HISTORY_UNFINISHED", "MIGRATION_NEW_CHECKSUM_CHANGED", "MIGRATION_HISTORICAL_FILE_CHANGED", "MIGRATION_PRIOR_BASELINE_CHANGED",
  "MIGRATION_OTHER_PENDING", "MIGRATION_IDENTITY_MISMATCH", "MIGRATION_DEPLOY_FAILED", "MIGRATION_APPLY_UNCONFIRMED",
  "MIGRATION_OPERATION_TIMEOUT", "MIGRATION_PREFLIGHT_CHANGED", "MIGRATION_FILES_CHANGED", "MIGRATION_STATE_CHANGED",
  "MIGRATION_POSTCHECK_FAILED", "MIGRATION_SCHEMA_CONFIGURATION_CHANGED"]);
const INDEXES = [
  [TABLE, `${TABLE}_pkey`, true, ["id"], null],
  [TABLE, `${TABLE}_stationId_status_createdAt_idx`, false, ["stationId", "status", "createdAt"], null],
  [TABLE, `${TABLE}_status_expiresAt_idx`, false, ["status", "expiresAt"], null],
  [TABLE, "catalogue_test_one_active_per_station", true, ["stationId"], "status=ANYARRAY['ARMED','RUNNING']"],
  [EVENT_TABLE, `${EVENT_TABLE}_pkey`, true, ["id"], null],
  [EVENT_TABLE, `${EVENT_TABLE}_testId_eventKey_key`, true, ["testId", "eventKey"], null],
  [EVENT_TABLE, `${EVENT_TABLE}_testId_occurredAt_idx`, false, ["testId", "occurredAt"], null]
];
const refusal = code => ({ ok: false, code });
const fail = code => { throw Object.assign(new Error(code), { code }); };
const sha256 = value => createHash("sha256").update(value).digest("hex");

export function catalogueTestMigrationMode(args = []) {
  if (!args.length || args.length === 1 && args[0] === "--check") return "check";
  if (args.length === 1 && args[0] === "--apply") return "apply";
  fail("MIGRATION_ARGUMENTS_INVALID");
}

export function catalogueTestMigrationPreflight(env = {}) {
  if (env.RUVANAS_ENVIRONMENT !== "PRIVATE_PREVIEW" || env.RENDER_SERVICE_ID !== SERVICE ||
      env.RUVANAS_PUBLIC_URL !== "https://www.ruvanas.com") return refusal("MIGRATION_HOST_REQUIRED");
  const preview = readPrivatePreviewPolicy(env);
  if (!preview.enabled || !preview.valid) return refusal("MIGRATION_PREVIEW_POLICY_REQUIRED");
  if (OFF_GATES.some(key => env[key] !== undefined && !["false", "0"].includes(env[key]))) return refusal("MIGRATION_OUTPUT_GATES_MUST_BE_OFF");
  if (env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined && env.NODE_TLS_REJECT_UNAUTHORIZED !== "1" ||
      env.PGSSLMODE !== undefined && !["require", "verify-ca", "verify-full"].includes(env.PGSSLMODE)) return refusal("MIGRATION_TLS_RELAXATION_FORBIDDEN");
  try {
    const raw = env.DATABASE_URL;
    if (typeof raw !== "string" || !raw || raw !== raw.trim()) return refusal("MIGRATION_DATABASE_REQUIRED");
    const url = new URL(raw), keys = [...url.searchParams.keys()];
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== DATABASE_HOST || url.pathname !== `/${DATABASE_NAME}` ||
        url.port && url.port !== "5432" || url.hash || !url.username || !url.password || keys.length !== new Set(keys).size ||
        keys.some(key => !QUERY_KEYS.has(key)) || url.searchParams.has("schema") && url.searchParams.get("schema") !== "public") return refusal("MIGRATION_DATABASE_REQUIRED");
    if (url.searchParams.has("sslmode") && !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode")) ||
        url.searchParams.has("sslaccept") && url.searchParams.get("sslaccept") !== "strict") return refusal("MIGRATION_TLS_RELAXATION_FORBIDDEN");
  } catch { return refusal("MIGRATION_DATABASE_REQUIRED"); }
  return { ok: true };
}

export function catalogueTestHistoryDigest(history) {
  return sha256(JSON.stringify(history.map(row => [row.migration_name, row.checksum]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

function catalogFiles(catalog) {
  if (!Array.isArray(catalog) || catalog.length !== 129) fail("MIGRATION_CATALOG_CHANGED");
  const files = new Map();
  for (const entry of catalog) {
    if (!entry || !NAME.test(entry.name || "") || !HASH.test(entry.checksum || "") || files.has(entry.name) ||
        [entry.checksumLF, entry.checksumCRLF].some(value => value !== undefined && !HASH.test(value))) fail("MIGRATION_CATALOG_CHANGED");
    files.set(entry.name, entry);
  }
  if (files.get(CATALOGUE_TEST_MIGRATION)?.checksum !== CATALOGUE_TEST_MIGRATION_CHECKSUM ||
      [...files.keys()].sort().at(-1) !== CATALOGUE_TEST_MIGRATION ||
      files.get(PREVIEW_ACCESS_MIGRATION)?.checksum !== PREVIEW_ACCESS_MIGRATION_CHECKSUM) fail("MIGRATION_CATALOG_CHANGED");
  return files;
}

async function schemaConfiguration(root) {
  const [schema, lock, entries] = await Promise.all([readFile(resolve(root, "prisma/schema.prisma"), "utf8"),
    readFile(resolve(root, "prisma/migrations/migration_lock.toml"), "utf8"), readdir(root)]);
  // The official CLI must use the same pinned credential URL as the preflight,
  // not a directUrl, another datasource or an automatically loaded config file.
  if ((schema.match(/\bdatasource\s+\w+\s*\{/g) || []).length !== 1 ||
      !/\bdatasource\s+db\s*\{\s*provider\s*=\s*"postgresql"\s*url\s*=\s*env\("DATABASE_URL"\)\s*\}/.test(schema) ||
      !/^\s*provider\s*=\s*"postgresql"\s*$/m.test(lock) || entries.some(name => /^prisma\.config\./.test(name))) fail("MIGRATION_SCHEMA_CONFIGURATION_CHANGED");
  return sha256(schema + "\0" + lock);
}

function checkTargetSchema(snapshot, applied) {
  if (!Array.isArray(snapshot.tables) || !Array.isArray(snapshot.indexes)) fail("MIGRATION_TARGET_SCHEMA_INVALID");
  if (!applied) {
    if (snapshot.tables.length || snapshot.indexes.length) fail("MIGRATION_TARGET_ALREADY_EXISTS");
    return;
  }
  if (snapshot.tables.length !== 2 || ![TABLE, EVENT_TABLE].every(name => snapshot.tables.some(row => row.tableName === name && row.kind === "r")) ||
      snapshot.indexes.length !== INDEXES.length) fail("MIGRATION_TARGET_SCHEMA_INVALID");
  for (const [tableName, indexName, unique, columns, predicate] of INDEXES) {
    const matches = snapshot.indexes.filter(row => row.indexName === indexName);
    if (matches.length !== 1) fail("MIGRATION_TARGET_SCHEMA_INVALID");
    const index = matches[0];
    const normalizedPredicate = index.predicate == null ? null : String(index.predicate).replace(/\s|::text|["()]/g, "");
    if (index.tableName !== tableName || index.unique !== unique || index.valid !== true || index.ready !== true || index.method !== "btree" ||
        JSON.stringify(index.columns) !== JSON.stringify(columns) || normalizedPredicate !== predicate) fail("MIGRATION_TARGET_SCHEMA_INVALID");
  }
}

export function decideCatalogueTestMigration(catalog, snapshot) {
  try {
    const files = catalogFiles(catalog);
    if (!Array.isArray(snapshot?.history) || ![128, 129].includes(snapshot.history.length)) fail("MIGRATION_HISTORY_INVALID");
    const seen = new Set(), prior = [];
    let applied = false, historicalLineEndingVariantCount = 0;
    for (const row of snapshot.history) {
      if (!row || !files.has(row.migration_name)) fail("MIGRATION_HISTORY_UNKNOWN");
      if (seen.has(row.migration_name)) fail("MIGRATION_HISTORY_DUPLICATE");
      seen.add(row.migration_name);
      if (!(row.finished_at instanceof Date) || !Number.isFinite(row.finished_at.getTime()) || row.rolled_back_at !== null || !HASH.test(row.checksum || "")) fail("MIGRATION_HISTORY_UNFINISHED");
      const file = files.get(row.migration_name);
      if (row.migration_name === CATALOGUE_TEST_MIGRATION) {
        if (row.checksum !== CATALOGUE_TEST_MIGRATION_CHECKSUM) fail("MIGRATION_NEW_CHECKSUM_CHANGED");
        applied = true;
      } else {
        if (row.checksum !== file.checksum) {
          if (row.migration_name === PREVIEW_ACCESS_MIGRATION || ![file.checksumLF, file.checksumCRLF].filter(Boolean).includes(row.checksum)) fail("MIGRATION_HISTORICAL_FILE_CHANGED");
          historicalLineEndingVariantCount++;
        }
        prior.push(row);
      }
    }
    if (prior.length !== 128 || catalogueTestHistoryDigest(prior) !== CATALOGUE_TEST_PRIOR_HISTORY_DIGEST) fail("MIGRATION_PRIOR_BASELINE_CHANGED");
    const pending = [...files.keys()].filter(name => !seen.has(name));
    if (applied ? pending.length !== 0 : pending.length !== 1 || pending[0] !== CATALOGUE_TEST_MIGRATION) fail("MIGRATION_OTHER_PENDING");
    checkTargetSchema(snapshot, applied);
    return { ok: true, action: applied ? "ALREADY_APPLIED" : "APPLY", verifiedPriorMigrationCount: 128, historicalLineEndingVariantCount };
  } catch (error) { return refusal(error?.code || "MIGRATION_HISTORY_INVALID"); }
}

async function databaseFactory(url) {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}

async function readSnapshot(db) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const identity = await tx.$queryRaw`SELECT current_database() AS "databaseName", current_schema() AS "schemaName"`;
    if (identity.length !== 1 || identity[0].databaseName !== DATABASE_NAME || identity[0].schemaName !== "public") fail("MIGRATION_IDENTITY_MISMATCH");
    const history = await tx.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
    const tables = await tx.$queryRaw`SELECT c.relname AS "tableName", c.relkind::text AS "kind" FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('OnlineRadioCatalogueTest', 'OnlineRadioCatalogueTestEvent') ORDER BY c.relname`;
    const indexes = await tx.$queryRaw`SELECT t.relname AS "tableName", c.relname AS "indexName", i.indisunique AS "unique", i.indisvalid AS "valid", i.indisready AS "ready", m.amname AS "method", pg_get_expr(i.indpred, i.indrelid) AS "predicate", ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality) JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.ordinality) AS "columns" FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid = i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid JOIN pg_catalog.pg_am m ON m.oid = c.relam WHERE n.nspname = 'public' AND t.relname IN ('OnlineRadioCatalogueTest', 'OnlineRadioCatalogueTestEvent') ORDER BY c.relname`;
    return { history, tables, indexes };
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 });
}

function deployOfficial({ root, env }) {
  const executable = REQUIRE.resolve("prisma/build/index.js");
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [executable, "migrate", "deploy", "--schema", resolve(root, "prisma", "schema.prisma")],
      { cwd: root, env, shell: false, windowsHide: true, stdio: "ignore" });
    let timedOut = false, killTimer, confirmationTimer, settled = false;
    const settle = error => {
      if (settled) return;
      settled = true; clearTimeout(timeout); clearTimeout(killTimer); clearTimeout(confirmationTimer);
      error ? reject(Object.assign(new Error(error), { code: error })) : resolveResult();
    };
    const kill = signal => { try { child.kill(signal); } catch { /* only actual close confirms termination */ } };
    const timeout = setTimeout(() => {
      timedOut = true; kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 2000);
      confirmationTimer = setTimeout(() => settle("MIGRATION_APPLY_UNCONFIRMED"), 6000);
    }, 120000);
    child.on("error", () => { if (child.pid == null) settle("MIGRATION_DEPLOY_FAILED"); });
    child.once("close", code => settle(timedOut ? "MIGRATION_APPLY_UNCONFIRMED" : code === 0 ? null : "MIGRATION_DEPLOY_FAILED"));
  });
}

export async function runCatalogueTestMigration({ mode = "check", env = process.env, root = ROOT,
  connect = databaseFactory, deploy = deployOfficial, clock = { setTimeout, clearTimeout } } = {}) {
  if (!["check", "apply"].includes(mode)) return refusal("MIGRATION_ARGUMENTS_INVALID");
  const preflight = catalogueTestMigrationPreflight(env);
  if (!preflight.ok) return preflight;
  let db, result;
  const bounded = (operation, ms, late = null) => new Promise((resolveResult, reject) => {
    let settled = false;
    const timer = clock.setTimeout(() => { settled = true; reject(Object.assign(new Error("MIGRATION_OPERATION_TIMEOUT"), { code: "MIGRATION_OPERATION_TIMEOUT" })); }, ms);
    Promise.resolve().then(() => {
      if (settled) fail("MIGRATION_OPERATION_TIMEOUT");
      return operation();
    }).then(value => {
      if (settled) { if (late) void Promise.resolve().then(() => late(value)).catch(() => {}); return; }
      settled = true; clock.clearTimeout(timer); resolveResult(value);
    }, error => { if (!settled) { settled = true; clock.clearTimeout(timer); reject(error); } });
  });
  try {
    const catalog = await readPreviewMigrationCatalog(root);
    catalogFiles(catalog); // Reject unreviewed SQL before a DB client is constructed.
    const schemaIdentity = await schemaConfiguration(root);
    db = await bounded(() => connect(env.DATABASE_URL), 10000, value => bounded(() => value.$disconnect(), 5000));
    const before = decideCatalogueTestMigration(catalog, await bounded(() => readSnapshot(db), 16000));
    if (!before.ok) fail(before.code);
    if (mode === "apply" && before.action === "APPLY") {
      if (!catalogueTestMigrationPreflight(env).ok) fail("MIGRATION_PREFLIGHT_CHANGED");
      const rechecked = await readPreviewMigrationCatalog(root);
      if (JSON.stringify(rechecked) !== JSON.stringify(catalog) || await schemaConfiguration(root) !== schemaIdentity) fail("MIGRATION_FILES_CHANGED");
      const fresh = decideCatalogueTestMigration(catalog, await bounded(() => readSnapshot(db), 16000));
      if (!fresh.ok || fresh.action !== "APPLY") fail(fresh.ok ? "MIGRATION_STATE_CHANGED" : fresh.code);
      try { await bounded(() => deploy({ root, env }), 130000); }
      catch (error) { if (error?.code === "MIGRATION_OPERATION_TIMEOUT") fail("MIGRATION_APPLY_UNCONFIRMED"); throw error; }
      const after = decideCatalogueTestMigration(catalog, await bounded(() => readSnapshot(db), 16000));
      if (!after.ok || after.action !== "ALREADY_APPLIED") fail(after.ok ? "MIGRATION_POSTCHECK_FAILED" : after.code);
      const finalCatalog = await readPreviewMigrationCatalog(root);
      if (JSON.stringify(finalCatalog) !== JSON.stringify(catalog) || await schemaConfiguration(root) !== schemaIdentity) fail("MIGRATION_FILES_CHANGED");
      result = { ok: true, status: "APPLIED", migration: CATALOGUE_TEST_MIGRATION, verifiedPriorMigrationCount: 128,
        historicalLineEndingVariantCount: after.historicalLineEndingVariantCount, streamingStarted: false };
    } else result = { ok: true, status: before.action === "ALREADY_APPLIED" ? "ALREADY_APPLIED" : "READY_READ_ONLY",
      migration: CATALOGUE_TEST_MIGRATION, verifiedPriorMigrationCount: 128,
      historicalLineEndingVariantCount: before.historicalLineEndingVariantCount, streamingStarted: false };
  } catch (error) {
    const code = SAFE_ERRORS.has(error?.code) ? error.code : "MIGRATION_GUARD_FAILED";
    result = refusal(code);
  } finally {
    if (db) try { await bounded(() => db.$disconnect(), 5000); } catch { result = refusal("MIGRATION_CLEANUP_UNVERIFIED"); }
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let result;
  try { result = await runCatalogueTestMigration({ mode: catalogueTestMigrationMode(process.argv.slice(2)) }); }
  catch { result = refusal("MIGRATION_ARGUMENTS_INVALID"); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
