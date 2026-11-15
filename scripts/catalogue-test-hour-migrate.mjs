// One-release extension guard. Default execution is read-only. Never repairs history.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { readPreviewMigrationCatalog, PREVIEW_ACCESS_MIGRATION, PREVIEW_ACCESS_MIGRATION_CHECKSUM } from "./private-preview-access-migrate.mjs";
import { catalogueTestMigrationMode, catalogueTestMigrationPreflight, decideCatalogueTestMigration,
  CATALOGUE_TEST_MIGRATION, CATALOGUE_TEST_MIGRATION_CHECKSUM } from "./catalogue-test-migrate.mjs";

export const CATALOGUE_TEST_HOUR_MIGRATION = "20261207000000_test_radio_one_hour_catalogue_test";
export const CATALOGUE_TEST_HOUR_MIGRATION_CHECKSUM = "117185a8c31901d55e5108d847c509d60600df9ffc593274295289e11af24aa9";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRE = createRequire(import.meta.url);
const TABLE = "OnlineRadioCatalogueTest", EVENT_TABLE = "OnlineRadioCatalogueTestEvent";
const SHA = /^[a-f0-9]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const refusal = code => ({ ok: false, code });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// Exact pg_get_constraintdef outputs verified with PostgreSQL (PGlite), not
// substring checks that could accept a weakened OR branch or changed precedence.
export const CATALOGUE_TEST_HOUR_CONSTRAINTS = Object.freeze({
  before: Object.freeze({
    catalogue_test_duration_bound: `CHECK ((("durationSeconds" >= 1) AND ("durationSeconds" <= 300)))`,
    catalogue_test_deadline: `CHECK ((("deadlineAt" IS NULL) OR (("requestedAt" IS NOT NULL) AND ("deadlineAt" > "requestedAt") AND ("deadlineAt" <= ("requestedAt" + '00:05:00'::interval)) AND ("deadlineAt" <= "expiresAt"))))`,
  }),
  after: Object.freeze({
    catalogue_test_duration_bound: `CHECK ((((("durationSeconds" >= 1) AND ("durationSeconds" <= 300)) OR (("durationSeconds" = 3600) AND ("stationId" = 'cmvcnbwi20008hr23sd76psi8'::text) AND (("authorization" -> 'profileId'::text) = '"ONE_HOUR"'::jsonb) AND (("authorization" -> 'maximumSeconds'::text) = '3600'::jsonb) AND (("authorization" -> 'stationId'::text) = to_jsonb("stationId")) AND (("authorization" -> 'organisationId'::text) = to_jsonb("organisationId")) AND (("authorization" -> 'kind'::text) = '"OWNER_CATALOGUE_TEST"'::jsonb) AND (("authorization" -> 'actorRole'::text) = '"SUPER_ADMIN"'::jsonb) AND ((plan -> 'profileId'::text) = '"ONE_HOUR"'::jsonb) AND ((plan -> 'targetSeconds'::text) = '3600'::jsonb) AND ("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '01:10:00'::interval)))) IS TRUE))`,
    catalogue_test_deadline: `CHECK (((("deadlineAt" IS NULL) OR (("requestedAt" IS NOT NULL) AND ("deadlineAt" > "requestedAt") AND ("deadlineAt" <= "expiresAt") AND ((("durationSeconds" <= 300) AND ("deadlineAt" <= ("requestedAt" + '00:05:00'::interval))) OR (("durationSeconds" = 3600) AND ("deadlineAt" <= ("requestedAt" + '01:00:00'::interval)))))) IS TRUE))`,
  }),
});
const SAFE_CODES = new Set([
  "MIGRATION_ARGUMENTS_INVALID", "MIGRATION_CATALOG_CHANGED", "MIGRATION_HISTORY_INVALID", "MIGRATION_PRIOR_REQUIRED",
  "MIGRATION_HOUR_HISTORY_INVALID", "MIGRATION_HOUR_SCHEMA_INVALID", "MIGRATION_TEST_MUST_BE_STOPPED",
  "MIGRATION_IDENTITY_MISMATCH", "MIGRATION_SCHEMA_CONFIGURATION_CHANGED", "MIGRATION_PREFLIGHT_CHANGED",
  "MIGRATION_FILES_CHANGED", "MIGRATION_STATE_CHANGED", "MIGRATION_POSTCHECK_FAILED", "MIGRATION_DEPLOY_FAILED",
  "MIGRATION_APPLY_UNCONFIRMED", "MIGRATION_OPERATION_TIMEOUT",
]);

function checkedCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length !== 130 || new Set(catalog.map(row => row?.name)).size !== 130 ||
      catalog.some(row => !/^\d{14}_[a-z0-9_]+$/.test(row?.name || "") || !SHA.test(row?.checksum || "")) ||
      catalog.find(row => row.name === CATALOGUE_TEST_HOUR_MIGRATION)?.checksum !== CATALOGUE_TEST_HOUR_MIGRATION_CHECKSUM ||
      catalog.map(row => row.name).sort().at(-1) !== CATALOGUE_TEST_HOUR_MIGRATION) fail("MIGRATION_CATALOG_CHANGED");
  // The previous release is now historical. Permit its unchanged checkout EOL
  // variant but continue pinning the actual applied checksum to its LF bytes.
  return catalog.filter(row => row.name !== CATALOGUE_TEST_HOUR_MIGRATION).map(row => {
    const pinned = row.name === CATALOGUE_TEST_MIGRATION ? CATALOGUE_TEST_MIGRATION_CHECKSUM :
      row.name === PREVIEW_ACCESS_MIGRATION ? PREVIEW_ACCESS_MIGRATION_CHECKSUM : null;
    if (!pinned) return row;
    if (![row.checksum, row.checksumLF, row.checksumCRLF].includes(pinned)) fail("MIGRATION_CATALOG_CHANGED");
    return { ...row, checksum: pinned };
  });
}

export function decideCatalogueTestHourMigration(catalog, snapshot) {
  try {
    const priorCatalog = checkedCatalog(catalog);
    if (!Array.isArray(snapshot?.history) || ![129, 130].includes(snapshot.history.length)) fail("MIGRATION_HISTORY_INVALID");
    const hourRows = snapshot.history.filter(row => row?.migration_name === CATALOGUE_TEST_HOUR_MIGRATION);
    if (hourRows.length > 1) fail("MIGRATION_HOUR_HISTORY_INVALID");
    const applied = hourRows.length === 1;
    if (applied && (hourRows[0].checksum !== CATALOGUE_TEST_HOUR_MIGRATION_CHECKSUM ||
      !(hourRows[0].finished_at instanceof Date) || !Number.isFinite(hourRows[0].finished_at.getTime()) ||
      hourRows[0].rolled_back_at !== null)) fail("MIGRATION_HOUR_HISTORY_INVALID");
    const prior = decideCatalogueTestMigration(priorCatalog, { ...snapshot,
      history: snapshot.history.filter(row => row?.migration_name !== CATALOGUE_TEST_HOUR_MIGRATION) });
    if (!prior.ok || prior.action !== "ALREADY_APPLIED") fail("MIGRATION_PRIOR_REQUIRED");
    const expected = CATALOGUE_TEST_HOUR_CONSTRAINTS[applied ? "after" : "before"];
    if (!Array.isArray(snapshot.constraints) || snapshot.constraints.length !== 2 ||
      new Set(snapshot.constraints.map(row => row.name)).size !== 2 || snapshot.constraints.some(row =>
        !Object.hasOwn(expected, row.name) || row.definition !== expected[row.name] || row.kind !== "c" ||
        row.validated !== true || row.deferrable !== false || row.deferred !== false || row.noInherit !== false)) fail("MIGRATION_HOUR_SCHEMA_INVALID");
    if (snapshot.activeTestCount !== 0) fail("MIGRATION_TEST_MUST_BE_STOPPED");
    return { ok: true, action: applied ? "ALREADY_APPLIED" : "APPLY", verifiedPriorMigrationCount: 129,
      historicalLineEndingVariantCount: prior.historicalLineEndingVariantCount };
  } catch (error) { return refusal(SAFE_CODES.has(error?.code) ? error.code : "MIGRATION_HISTORY_INVALID"); }
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
    const tables = await tx.$queryRaw`SELECT c.relname AS "tableName", c.relkind::text AS "kind" FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('OnlineRadioCatalogueTest', 'OnlineRadioCatalogueTestEvent') ORDER BY c.relname`;
    const indexes = await tx.$queryRaw`SELECT t.relname AS "tableName", c.relname AS "indexName", i.indisunique AS "unique", i.indisvalid AS "valid", i.indisready AS "ready", m.amname AS "method", pg_get_expr(i.indpred, i.indrelid) AS "predicate", ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality) JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.ordinality) AS "columns" FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid = i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid JOIN pg_catalog.pg_am m ON m.oid = c.relam WHERE n.nspname = 'public' AND t.relname IN ('OnlineRadioCatalogueTest', 'OnlineRadioCatalogueTestEvent') ORDER BY c.relname`;
    const constraints = await tx.$queryRaw`SELECT c.conname AS "name", c.contype::text AS "kind", c.convalidated AS "validated", c.condeferrable AS "deferrable", c.condeferred AS "deferred", c.connoinherit AS "noInherit", pg_get_constraintdef(c.oid) AS "definition" FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid = c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relname = 'OnlineRadioCatalogueTest' AND c.conname IN ('catalogue_test_duration_bound', 'catalogue_test_deadline') ORDER BY c.conname`;
    const active = await tx.$queryRaw`SELECT count(*)::integer AS "activeTestCount" FROM "OnlineRadioCatalogueTest" WHERE "stationId" = 'cmvcnbwi20008hr23sd76psi8' AND "status" IN ('ARMED', 'RUNNING')`;
    return { history, tables, indexes, constraints, activeTestCount: active.length === 1 ? active[0].activeTestCount : null };
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
    const kill = signal => { try { child.kill(signal); } catch { /* close alone proves termination */ } };
    const timeout = setTimeout(() => {
      timedOut = true; kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 2000);
      confirmationTimer = setTimeout(() => settle("MIGRATION_APPLY_UNCONFIRMED"), 6000);
    }, 120000);
    child.on("error", () => { if (child.pid == null) settle("MIGRATION_DEPLOY_FAILED"); });
    child.once("close", code => settle(timedOut ? "MIGRATION_APPLY_UNCONFIRMED" : code === 0 ? null : "MIGRATION_DEPLOY_FAILED"));
  });
}

export async function runCatalogueTestHourMigration({ mode = "check", env = process.env, root = ROOT,
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
    const catalog = await readPreviewMigrationCatalog(root);
    checkedCatalog(catalog); // No DB connection for an unreviewed migration catalog.
    const configuration = await schemaConfiguration(root);
    db = await bounded(() => connect(env.DATABASE_URL), 10000, value => bounded(() => value.$disconnect(), 5000));
    const before = decideCatalogueTestHourMigration(catalog, await bounded(() => readSnapshot(db), 16000));
    if (!before.ok) fail(before.code);
    if (mode === "apply" && before.action === "APPLY") {
      if (!catalogueTestMigrationPreflight(env).ok) fail("MIGRATION_PREFLIGHT_CHANGED");
      if (JSON.stringify(await readPreviewMigrationCatalog(root)) !== JSON.stringify(catalog) || await schemaConfiguration(root) !== configuration) fail("MIGRATION_FILES_CHANGED");
      const fresh = decideCatalogueTestHourMigration(catalog, await bounded(() => readSnapshot(db), 16000));
      if (!fresh.ok || fresh.action !== "APPLY") fail(fresh.ok ? "MIGRATION_STATE_CHANGED" : fresh.code);
      try { await bounded(() => deploy({ root, env }), 130000); }
      catch (error) { if (error?.code === "MIGRATION_OPERATION_TIMEOUT") fail("MIGRATION_APPLY_UNCONFIRMED"); throw error; }
      const after = decideCatalogueTestHourMigration(catalog, await bounded(() => readSnapshot(db), 16000));
      if (!after.ok || after.action !== "ALREADY_APPLIED") fail(after.ok ? "MIGRATION_POSTCHECK_FAILED" : after.code);
      if (JSON.stringify(await readPreviewMigrationCatalog(root)) !== JSON.stringify(catalog) || await schemaConfiguration(root) !== configuration) fail("MIGRATION_FILES_CHANGED");
      result = { ok: true, status: "APPLIED", migration: CATALOGUE_TEST_HOUR_MIGRATION, verifiedPriorMigrationCount: 129, streamingStarted: false };
    } else result = { ok: true, status: before.action === "ALREADY_APPLIED" ? "ALREADY_APPLIED" : "READY_READ_ONLY",
      migration: CATALOGUE_TEST_HOUR_MIGRATION, verifiedPriorMigrationCount: 129, streamingStarted: false };
  } catch (error) { result = refusal(SAFE_CODES.has(error?.code) ? error.code : "MIGRATION_GUARD_FAILED"); }
  finally { if (db) try { await bounded(() => db.$disconnect(), 5000); } catch { result = refusal("MIGRATION_CLEANUP_UNVERIFIED"); } }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let result;
  try { result = await runCatalogueTestHourMigration({ mode: catalogueTestMigrationMode(process.argv.slice(2)) }); }
  catch { result = refusal("MIGRATION_ARGUMENTS_INVALID"); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
