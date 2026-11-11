// Standalone additive release step. Imports and default execution do not write.
// Apply only the pinned column addition; never run the pending migration queue.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { subscriberTestingMigrationPreflight } from "./subscriber-testing-migrate.mjs";

export const CATALOGUE_ALL_TIERS_MIGRATION = "20261210000000_catalogue_all_tiers";
export const CATALOGUE_ALL_TIERS_SQL_CHECKSUM = "68174d766c207ebe0ba6036af9213b94212ed7ad90533baa8891dae9333a5cae";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAFE = new Set(["CATALOGUE_COLUMN_ARGUMENTS_INVALID", "CATALOGUE_COLUMN_SQL_CHANGED",
  "CATALOGUE_COLUMN_IDENTITY_MISMATCH", "CATALOGUE_COLUMN_TABLE_UNSAFE", "CATALOGUE_COLUMN_DDL_UNSAFE",
  "CATALOGUE_COLUMN_DEFINITION_INVALID", "CATALOGUE_COLUMN_PREFLIGHT_CHANGED", "CATALOGUE_COLUMN_POSTCHECK_FAILED"]);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const refusal = code => ({ ok: false, code });

export function catalogueAllTiersApplyMode(args = []) {
  if (!args.length || args.length === 1 && args[0] === "--check") return "check";
  if (args.length === 1 && args[0] === "--apply") return "apply";
  fail("CATALOGUE_COLUMN_ARGUMENTS_INVALID");
}

export async function readPinnedCatalogueAllTiersSql(root = ROOT) {
  const sql = (await readFile(resolve(root, "prisma/migrations", CATALOGUE_ALL_TIERS_MIGRATION, "migration.sql"), "utf8"))
    .replace(/\r\n/g, "\n");
  if (createHash("sha256").update(sql).digest("hex") !== CATALOGUE_ALL_TIERS_SQL_CHECKSUM) fail("CATALOGUE_COLUMN_SQL_CHANGED");
  return sql;
}

export function catalogueAllTiersColumnState(columns) {
  if (!Array.isArray(columns)) fail("CATALOGUE_COLUMN_DEFINITION_INVALID");
  if (!columns.length) return "MISSING";
  const column = columns[0];
  if (columns.length !== 1 || column?.tableName !== "Track" || column.columnName !== "catalogueAllTiers" ||
    column.dataType !== "boolean" || column.nullable !== "NO" || column.defaultValue !== "false" ||
    column.identity !== "NO" || column.generated !== "NEVER") fail("CATALOGUE_COLUMN_DEFINITION_INVALID");
  return "PRESENT";
}

async function databaseFactory(url) {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}

async function assertDatabase(tx) {
  const identity = await tx.$queryRaw`SELECT current_database() AS "databaseName", current_schema() AS "schemaName",
    current_setting('server_version_num')::integer AS "serverVersion"`;
  if (identity.length !== 1 || identity[0].databaseName !== "ruvanas_private_preview_20261011" ||
    identity[0].schemaName !== "public") fail("CATALOGUE_COLUMN_IDENTITY_MISMATCH");
  // PostgreSQL 11+ adds this constant default without rewriting existing rows.
  if (!Number.isInteger(identity[0].serverVersion) || identity[0].serverVersion < 110000) fail("CATALOGUE_COLUMN_DDL_UNSAFE");
  const table = await tx.$queryRaw`SELECT c.relkind::text AS "kind", c.relpersistence::text AS "persistence",
    c.relispartition AS "partition"
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'Track'`;
  if (table.length !== 1 || table[0].kind !== "r" || table[0].persistence !== "p" ||
    table[0].partition !== false) fail("CATALOGUE_COLUMN_TABLE_UNSAFE");
  // DDL event triggers can execute unrelated writes even for an additive ALTER.
  const triggers = await tx.$queryRaw`SELECT count(*)::integer AS "enabled" FROM pg_catalog.pg_event_trigger WHERE evtenabled <> 'D'`;
  if (triggers.length !== 1 || triggers[0].enabled !== 0) fail("CATALOGUE_COLUMN_DDL_UNSAFE");
}

async function readColumn(tx) {
  return tx.$queryRaw`SELECT table_name AS "tableName", column_name AS "columnName", data_type AS "dataType",
    is_nullable AS "nullable", column_default AS "defaultValue", is_identity AS "identity", is_generated AS "generated"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Track' AND column_name = 'catalogueAllTiers'`;
}

export async function runCatalogueAllTiersAddition({ mode = "check", env = process.env, root = ROOT, connect = databaseFactory } = {}) {
  if (!["check", "apply"].includes(mode)) return refusal("CATALOGUE_COLUMN_ARGUMENTS_INVALID");
  const policy = subscriberTestingMigrationPreflight(env);
  if (!policy.ok) return policy;
  const databaseUrl = env.DATABASE_URL;
  let db, result;
  try {
    const sql = await readPinnedCatalogueAllTiersSql(root);
    db = await connect(databaseUrl);
    result = await db.$transaction(async tx => {
      if (mode === "check") await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '10000ms'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`;
      await assertDatabase(tx);
      let state = catalogueAllTiersColumnState(await readColumn(tx)), added = false;
      if (mode === "apply" && state === "MISSING") {
        // Bound waiting for the brief DDL lock; no worker is restarted or paused.
        await tx.$executeRaw`LOCK TABLE "public"."Track" IN ACCESS EXCLUSIVE MODE`;
        await assertDatabase(tx);
        // ReadCommitted sees a concurrent addition after obtaining the lock.
        state = catalogueAllTiersColumnState(await readColumn(tx));
        if (state === "MISSING") {
          if (!subscriberTestingMigrationPreflight(env).ok || env.DATABASE_URL !== databaseUrl) fail("CATALOGUE_COLUMN_PREFLIGHT_CHANGED");
          if (await readPinnedCatalogueAllTiersSql(root) !== sql) fail("CATALOGUE_COLUMN_SQL_CHANGED");
          await tx.$executeRaw`SET LOCAL search_path = public, pg_catalog`;
          // Only the checksum-pinned SQL is dynamic, with no interpolated input.
          await tx.$executeRawUnsafe(sql);
          if (catalogueAllTiersColumnState(await readColumn(tx)) !== "PRESENT") fail("CATALOGUE_COLUMN_POSTCHECK_FAILED");
          added = true;
        }
      }
      return { ok: true, status: added ? "APPLIED" : state === "MISSING" ? "READY_READ_ONLY" : "ALREADY_ALIGNED",
        migration: CATALOGUE_ALL_TIERS_MIGRATION, columnAdded: added, rowUpdatesIssued: false,
        migrationHistoryChanged: false, otherPendingMigrationsApplied: false, streamingControlsChanged: false };
    }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  } catch (error) {
    result = refusal(SAFE.has(error?.code) ? error.code : "CATALOGUE_COLUMN_OPERATION_UNCONFIRMED");
  } finally {
    if (db) try { await db.$disconnect(); } catch { result = refusal("CATALOGUE_COLUMN_CLEANUP_UNVERIFIED"); }
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let result;
  try { result = await runCatalogueAllTiersAddition({ mode: catalogueAllTiersApplyMode(process.argv.slice(2)) }); }
  catch { result = refusal("CATALOGUE_COLUMN_ARGUMENTS_INVALID"); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
