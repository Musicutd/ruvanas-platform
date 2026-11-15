// One-release data correction. Default execution is read-only; imports do nothing.
// Execute only this pinned Plan UPDATE, never migrate deploy or migration resolve.
// Leaving its idempotent migration pending avoids applying unrelated migrations.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { subscriberTestingMigrationPreflight } from "./subscriber-testing-migrate.mjs";

export const RETAIL_PLAN_MIGRATION = "20261209000000_retail_focused_catalogue_audio_only";
export const RETAIL_PLAN_SQL_CHECKSUM = "2d8c8af57555e30cd57e2a74ee6049bada810474e66f332697523729e9797230";
export const RETAIL_PLAN_CODES = Object.freeze([
  "RETAIL_START", "RETAIL_BUSINESS", "RETAIL_PROFESSIONAL", "RETAIL_ADVANCED", "RETAIL_ENTERPRISE"
]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EDITABLE = new Set(["licensedMusicCatalogueLevel", "digitalSignageEnabled", "updatedAt"]);
const SAFE = new Set(["RETAIL_PLAN_ARGUMENTS_INVALID", "RETAIL_PLAN_SQL_CHANGED", "RETAIL_PLAN_IDENTITY_MISMATCH",
  "RETAIL_PLAN_TABLE_UNSAFE", "RETAIL_PLAN_TARGETS_INVALID", "RETAIL_PLAN_STATE_INVALID", "RETAIL_PLAN_POSTCHECK_FAILED",
  "RETAIL_PLAN_PREFLIGHT_CHANGED"]);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const refusal = code => ({ ok: false, code });
const digest = value => createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function retailPlanApplyMode(args = []) {
  if (!args.length || args.length === 1 && args[0] === "--check") return "check";
  if (args.length === 1 && args[0] === "--apply") return "apply";
  fail("RETAIL_PLAN_ARGUMENTS_INVALID");
}

export async function readPinnedRetailPlanSql(root = ROOT) {
  const sql = (await readFile(resolve(root, "prisma/migrations", RETAIL_PLAN_MIGRATION, "migration.sql"), "utf8"))
    .replace(/\r\n/g, "\n");
  if (digest(sql) !== RETAIL_PLAN_SQL_CHECKSUM) fail("RETAIL_PLAN_SQL_CHANGED");
  return sql;
}

function checkedPlans(rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== "string" || !row.id ||
    typeof row.code !== "string") || new Set(rows.map(row => row.id)).size !== rows.length ||
    new Set(rows.map(row => row.code)).size !== rows.length) fail("RETAIL_PLAN_STATE_INVALID");
  const targets = RETAIL_PLAN_CODES.map(code => rows.find(row => row.code === code));
  if (targets.some(row => !row || row.productFamily !== "RETAIL" || row.includesRuvanasCatalogue !== true ||
    !["NONE", "FOCUSED", "PROFESSIONAL", "PREMIUM"].includes(row.licensedMusicCatalogueLevel) ||
    typeof row.digitalSignageEnabled !== "boolean" || !Number.isFinite(Date.parse(row.updatedAt)))) {
    fail("RETAIL_PLAN_TARGETS_INVALID");
  }
  return targets;
}

export function verifyRetailPlanCorrection(before, after, changedRows) {
  const targets = checkedPlans(before);
  checkedPlans(after);
  const expectedChanges = targets.filter(row => row.licensedMusicCatalogueLevel !== "FOCUSED" || row.digitalSignageEnabled).length;
  if (changedRows !== expectedChanges || after.length !== before.length) fail("RETAIL_PLAN_POSTCHECK_FAILED");
  const targetIds = new Set(targets.map(row => row.id));
  const afterById = new Map(after.map(row => [row.id, row]));
  for (const old of before) {
    const current = afterById.get(old.id);
    if (!current) fail("RETAIL_PLAN_POSTCHECK_FAILED");
    if (!targetIds.has(old.id)) {
      if (canonical(old) !== canonical(current)) fail("RETAIL_PLAN_POSTCHECK_FAILED");
      continue;
    }
    const preserved = row => Object.fromEntries(Object.entries(row).filter(([key]) => !EDITABLE.has(key)));
    if (canonical(preserved(old)) !== canonical(preserved(current)) ||
      current.licensedMusicCatalogueLevel !== "FOCUSED" || current.digitalSignageEnabled !== false ||
      !Number.isFinite(Date.parse(current.updatedAt)) ||
      old.licensedMusicCatalogueLevel === "FOCUSED" && !old.digitalSignageEnabled && old.updatedAt !== current.updatedAt) {
      fail("RETAIL_PLAN_POSTCHECK_FAILED");
    }
  }
  return expectedChanges;
}

async function databaseFactory(url) {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}

async function assertDatabase(tx) {
  const identity = await tx.$queryRaw`SELECT current_database() AS "databaseName", current_schema() AS "schemaName"`;
  if (identity.length !== 1 || identity[0].databaseName !== "ruvanas_private_preview_20261011" ||
    identity[0].schemaName !== "public") fail("RETAIL_PLAN_IDENTITY_MISMATCH");
  // Refuse a view, RLS policy, rule or user trigger that could hide rows or add side effects.
  const table = await tx.$queryRaw`SELECT c.relkind::text AS "kind", c.relrowsecurity AS "rowSecurity",
    (SELECT count(*)::integer FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS "userTriggers",
    (SELECT count(*)::integer FROM pg_catalog.pg_rewrite r WHERE r.ev_class = c.oid) AS "rules"
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'Plan'`;
  if (table.length !== 1 || table[0].kind !== "r" || table[0].rowSecurity !== false ||
    table[0].userTriggers !== 0 || table[0].rules !== 0) fail("RETAIL_PLAN_TABLE_UNSAFE");
}

async function readPlans(tx) {
  const rows = await tx.$queryRaw`SELECT to_jsonb(p) AS "plan" FROM "public"."Plan" p ORDER BY p."id"`;
  return rows.map(row => row.plan);
}

export async function runRetailPlanCorrection({ mode = "check", env = process.env, root = ROOT, connect = databaseFactory } = {}) {
  if (!["check", "apply"].includes(mode)) return refusal("RETAIL_PLAN_ARGUMENTS_INVALID");
  // Reuse the established exact website/database/TLS and closed-registration guard.
  const policy = subscriberTestingMigrationPreflight(env);
  if (!policy.ok) return policy;
  let db, result;
  try {
    const sql = await readPinnedRetailPlanSql(root);
    db = await connect(env.DATABASE_URL);
    result = await db.$transaction(async tx => {
      if (mode === "check") await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '10000ms'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`;
      await assertDatabase(tx);
      if (mode === "apply") {
        // Row locks on five plans do not block stream reads or touch worker records.
        await tx.$queryRaw`SELECT "id" FROM "public"."Plan"
          WHERE "productFamily" = 'RETAIL' AND "code" IN
          ('RETAIL_START', 'RETAIL_BUSINESS', 'RETAIL_PROFESSIONAL', 'RETAIL_ADVANCED', 'RETAIL_ENTERPRISE')
          ORDER BY "id" FOR UPDATE`;
      }
      const before = await readPlans(tx), targets = checkedPlans(before);
      const requiredChanges = targets.filter(row => row.licensedMusicCatalogueLevel !== "FOCUSED" || row.digitalSignageEnabled).length;
      if (mode === "apply" && requiredChanges) {
        if (!subscriberTestingMigrationPreflight(env).ok) fail("RETAIL_PLAN_PREFLIGHT_CHANGED");
        if (await readPinnedRetailPlanSql(root) !== sql) fail("RETAIL_PLAN_SQL_CHANGED");
        await tx.$executeRaw`SET LOCAL search_path = public, pg_catalog`;
        // The only dynamic SQL is pinned byte-for-byte above; it has no user inputs.
        const updated = await tx.$executeRawUnsafe(sql);
        verifyRetailPlanCorrection(before, await readPlans(tx), updated);
      }
      return { ok: true, status: mode === "check" && requiredChanges ? "READY_READ_ONLY" : requiredChanges ? "APPLIED" : "ALREADY_ALIGNED",
        migration: RETAIL_PLAN_MIGRATION, planCodes: [...RETAIL_PLAN_CODES], requiredChanges,
        updatedRows: mode === "apply" ? requiredChanges : 0, otherPlanValuesPreserved: true,
        migrationHistoryChanged: false, otherPendingMigrationsApplied: false, streamingControlsChanged: false };
    }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 });
  } catch (error) {
    result = refusal(SAFE.has(error?.code) ? error.code : "RETAIL_PLAN_OPERATION_UNCONFIRMED");
  } finally {
    if (db) try { await db.$disconnect(); } catch { result = refusal("RETAIL_PLAN_CLEANUP_UNVERIFIED"); }
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let result;
  try { result = await runRetailPlanCorrection({ mode: retailPlanApplyMode(process.argv.slice(2)) }); }
  catch { result = refusal("RETAIL_PLAN_ARGUMENTS_INVALID"); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
