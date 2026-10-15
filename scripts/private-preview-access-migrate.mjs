import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { readPrivatePreviewPolicy } from "../lib/private-preview-policy.mjs";

export const PREVIEW_ACCESS_MIGRATION = "20261205000000_private_preview_account_access";
export const PREVIEW_ACCESS_MIGRATION_CHECKSUM = "1ee8b9858b82d52f9d180b51f07e5600a2aaeda63a2b8e6259054e8b3ac85669";
const SERVICE_ID = "srv-da03b5lbedkc739q74k0";
const PUBLIC_URL = "https://ruvanas-platform.onrender.com";
const DATABASE_HOST = "dpg-db5kurijnfac73arripg-a";
const DATABASE_NAME = "ruvanas_private_preview_20261011";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRE = createRequire(import.meta.url);
const QUERY_PARAMETERS = new Set(["schema", "sslmode", "sslaccept", "connection_limit", "pool_timeout", "connect_timeout"]);

function refusal(code) { return { ok: false, code }; }
function fail(code) { const error = new Error(code); error.code = code; throw error; }

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

// The only historical alternatives are hashes derived from these exact file
// bytes with consistent LF <-> CRLF substitution. No SQL, whitespace, encoding,
// BOM, lone-CR or mixed-line-ending normalization is permitted.
export function previewMigrationChecksumEvidence(name, input) {
  const bytes = Buffer.from(input);
  const evidence = { name, checksum: sha256(bytes) };
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return evidence;
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return evidence; }
  if (!Buffer.from(text, "utf8").equals(bytes)) return evidence;
  const withoutCrlf = text.replace(/\r\n/g, "");
  if (withoutCrlf.includes("\r") || (text.includes("\r\n") && withoutCrlf.includes("\n"))) return evidence;
  const lf = text.replace(/\r\n/g, "\n");
  return { ...evidence, checksumLF: sha256(Buffer.from(lf, "utf8")),
    checksumCRLF: sha256(Buffer.from(lf.replace(/\n/g, "\r\n"), "utf8")) };
}

// No connection, Prisma import or child process is attempted before this exact
// already-paid service / isolated database guard passes. URLs and credentials
// are never returned by preflight or printed by the command.
export function privatePreviewAccessMigrationPreflight(env = {}) {
  if (env.RUVANAS_ENVIRONMENT !== "PRIVATE_PREVIEW" || env.RENDER_SERVICE_ID !== SERVICE_ID ||
      env.RUVANAS_PUBLIC_URL !== PUBLIC_URL) return refusal("PREVIEW_HOST_REQUIRED");
  const policy = readPrivatePreviewPolicy(env);
  if (!policy.enabled || !policy.valid) return refusal("PREVIEW_POLICY_REQUIRED");
  // Optional deployment witnesses are redundant metadata, never authority.
  // The credential URL and live SQL identity below remain hard-pinned.
  if ((env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST !== undefined &&
       env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST !== DATABASE_HOST) ||
      (env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME !== undefined &&
       env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME !== DATABASE_NAME)) return refusal("PREVIEW_DATABASE_REQUIRED");
  if ((env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined && env.NODE_TLS_REJECT_UNAUTHORIZED !== "1") ||
      (env.PGSSLMODE !== undefined && !["require", "verify-ca", "verify-full"].includes(env.PGSSLMODE))) {
    return refusal("TLS_RELAXATION_FORBIDDEN");
  }
  try {
    const raw = env.DATABASE_URL;
    if (typeof raw !== "string" || !raw || raw !== raw.trim()) return refusal("PREVIEW_DATABASE_REQUIRED");
    const url = new URL(raw);
    const keys = [...url.searchParams.keys()];
    const schema = url.searchParams.get("schema");
    const mode = url.searchParams.get("sslmode");
    const accept = url.searchParams.get("sslaccept");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== DATABASE_HOST ||
        url.pathname !== `/${DATABASE_NAME}` || (url.port && url.port !== "5432") || url.hash ||
        !url.username || !url.password || keys.length !== new Set(keys).size ||
        keys.some((key) => !QUERY_PARAMETERS.has(key)) || (schema !== null && schema !== "public")) {
      return refusal("PREVIEW_DATABASE_REQUIRED");
    }
    if ((mode !== null && !["require", "verify-ca", "verify-full"].includes(mode)) ||
        (accept !== null && accept !== "strict")) return refusal("TLS_RELAXATION_FORBIDDEN");
  } catch { return refusal("PREVIEW_DATABASE_REQUIRED"); }
  return { ok: true };
}

export async function readPreviewMigrationCatalog(root = ROOT) {
  const directory = resolve(root, "prisma", "migrations");
  const entries = await readdir(directory, { withFileTypes: true });
  const catalog = [];
  for (const entry of entries) {
    if (entry.name === "migration_lock.toml" && entry.isFile()) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^\d{14}_[a-z0-9_]+$/.test(entry.name)) {
      fail("MIGRATION_FILES_UNEXPECTED");
    }
    const bytes = await readFile(resolve(directory, entry.name, "migration.sql"));
    catalog.push(previewMigrationChecksumEvidence(entry.name, bytes));
  }
  return catalog.sort((left, right) => left.name.localeCompare(right.name));
}

// Historical checksums and their strictly derived EOL variants come from the
// local file bytes, never database-provided alternatives. The sole new file and
// its applied database row must still match the exact pinned LF bytes.
export function decidePreviewAccessMigration(catalog, history) {
  if (!Array.isArray(catalog) || !catalog.length || !Array.isArray(history)) return refusal("MIGRATION_HISTORY_INVALID");
  const files = new Map();
  for (const migration of catalog) {
    if (!migration || typeof migration.name !== "string" ||
        !/^\d{14}_[a-z0-9_]+$/.test(migration.name) || !/^[a-f0-9]{64}$/.test(migration.checksum || "") ||
        files.has(migration.name)) return refusal("MIGRATION_FILES_UNEXPECTED");
    if ([migration.checksumLF, migration.checksumCRLF].some((checksum) =>
      checksum !== undefined && !/^[a-f0-9]{64}$/.test(checksum))) return refusal("MIGRATION_FILES_UNEXPECTED");
    files.set(migration.name, migration);
  }
  if (files.get(PREVIEW_ACCESS_MIGRATION)?.checksum !== PREVIEW_ACCESS_MIGRATION_CHECKSUM ||
      [...files.keys()].sort().at(-1) !== PREVIEW_ACCESS_MIGRATION) return refusal("ADDITIVE_MIGRATION_CHANGED");
  const applied = new Set();
  let historicalLineEndingVariantCount = 0;
  for (const row of history) {
    if (!row || !files.has(row.migration_name)) return refusal("UNKNOWN_DATABASE_MIGRATION");
    if (applied.has(row.migration_name)) return refusal("DUPLICATE_DATABASE_MIGRATION");
    if (!row.finished_at || row.rolled_back_at) return refusal("MIGRATION_HISTORY_NOT_CLEAN");
    const file = files.get(row.migration_name);
    if (row.checksum !== file.checksum) {
      if (row.migration_name === PREVIEW_ACCESS_MIGRATION ||
          ![file.checksumLF, file.checksumCRLF].filter(Boolean).includes(row.checksum)) {
        return { ...refusal("HISTORICAL_MIGRATION_CHANGED"), migrationName: row.migration_name };
      }
      historicalLineEndingVariantCount++;
    }
    applied.add(row.migration_name);
  }
  const pending = [...files.keys()].filter((name) => !applied.has(name));
  if (!pending.length) return { ok: true, action: "ALREADY_APPLIED", migrationCount: files.size, historicalLineEndingVariantCount };
  if (pending.length !== 1 || pending[0] !== PREVIEW_ACCESS_MIGRATION) return refusal("OTHER_PENDING_MIGRATION");
  return { ok: true, action: "DEPLOY", migrationCount: files.size, historicalLineEndingVariantCount };
}

async function databaseFactory(url) {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}

async function readHistory(database) {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const identity = await tx.$queryRaw`SELECT current_database() AS "databaseName", current_schema() AS "schemaName"`;
    if (identity.length !== 1 || identity[0].databaseName !== DATABASE_NAME || identity[0].schemaName !== "public") {
      fail("DATABASE_IDENTITY_MISMATCH");
    }
    return tx.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at, id`;
  });
}

function deployWithOfficialPrisma({ root, env }) {
  const executable = REQUIRE.resolve("prisma/build/index.js");
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [executable, "migrate", "deploy", "--schema", resolve(root, "prisma", "schema.prisma")], {
      cwd: root, env, shell: false, windowsHide: true, stdio: "ignore",
      timeout: 120_000, killSignal: "SIGTERM"
    });
    child.once("error", () => reject(new Error("MIGRATION_DEPLOY_FAILED")));
    child.once("close", (code) => code === 0 ? resolveResult() : reject(new Error("MIGRATION_DEPLOY_FAILED")));
  });
}

async function verifyAccountDatabase(database, options) {
  const { runPreviewAccountDatabaseAcceptance } = await import("./private-preview-account-db-acceptance.mjs");
  return runPreviewAccountDatabaseAcceptance(database, options);
}

export async function runGuardedPreviewAccessMigration({
  env = process.env, root = ROOT, connect = databaseFactory, deploy = deployWithOfficialPrisma,
  acceptance = verifyAccountDatabase
} = {}) {
  const preflight = privatePreviewAccessMigrationPreflight(env);
  if (!preflight.ok) return preflight;
  let database;
  let result;
  let changedMigrationName;
  let historicalLineEndingVariantCount;
  let knownMigrationNames = new Set();
  try {
    const catalog = await readPreviewMigrationCatalog(root);
    knownMigrationNames = new Set(catalog.map((entry) => entry.name));
    // Check the pinned file before even connecting to the database.
    const fileCheck = decidePreviewAccessMigration(catalog,
      catalog.filter((entry) => entry.name !== PREVIEW_ACCESS_MIGRATION).map((entry) => ({
        migration_name: entry.name, checksum: entry.checksum, finished_at: new Date(0), rolled_back_at: null
      })));
    if (!fileCheck.ok) return fileCheck;
    database = await connect(env.DATABASE_URL);
    const before = decidePreviewAccessMigration(catalog, await readHistory(database));
    if (!before.ok) { changedMigrationName = before.migrationName; fail(before.code); }
    historicalLineEndingVariantCount = before.historicalLineEndingVariantCount;
    if (before.action === "DEPLOY") {
      const rechecked = await readPreviewMigrationCatalog(root);
      if (JSON.stringify(rechecked) !== JSON.stringify(catalog)) fail("MIGRATION_FILES_CHANGED_DURING_GUARD");
      await deploy({ root, env });
      const verified = decidePreviewAccessMigration(catalog, await readHistory(database));
      if (!verified.ok && verified.code === "HISTORICAL_MIGRATION_CHANGED") {
        changedMigrationName = verified.migrationName;
        fail(verified.code);
      }
      if (!verified.ok || verified.action !== "ALREADY_APPLIED") fail("MIGRATION_POSTCHECK_FAILED");
    }
    const acceptanceResult = await acceptance(database, { env });
    if (!acceptanceResult?.ok || acceptanceResult.status !== "ROLLED_BACK_PASS") fail("DATABASE_ACCEPTANCE_FAILED");
    result = { ok: true, status: before.action === "DEPLOY" ? "APPLIED" : "ALREADY_APPLIED",
      migration: PREVIEW_ACCESS_MIGRATION, verifiedMigrationCount: before.migrationCount,
      historicalLineEndingVariantCount,
      accountAcceptance: "ROLLED_BACK_PASS" };
  } catch (error) {
    const permitted = new Set(["MIGRATION_FILES_UNEXPECTED", "DATABASE_IDENTITY_MISMATCH", "MIGRATION_DEPLOY_FAILED",
      "MIGRATION_HISTORY_INVALID", "ADDITIVE_MIGRATION_CHANGED", "UNKNOWN_DATABASE_MIGRATION",
      "DUPLICATE_DATABASE_MIGRATION", "MIGRATION_HISTORY_NOT_CLEAN", "HISTORICAL_MIGRATION_CHANGED",
      "OTHER_PENDING_MIGRATION", "MIGRATION_FILES_CHANGED_DURING_GUARD", "MIGRATION_POSTCHECK_FAILED",
      "DATABASE_ACCEPTANCE_FAILED"]);
    result = refusal(permitted.has(error?.code) ? error.code :
      error?.message === "MIGRATION_DEPLOY_FAILED" ? "MIGRATION_DEPLOY_FAILED" : "MIGRATION_GUARD_FAILED");
    if (result.code === "HISTORICAL_MIGRATION_CHANGED" && knownMigrationNames.has(changedMigrationName)) {
      result.migrationName = changedMigrationName;
    }
    if (Number.isSafeInteger(historicalLineEndingVariantCount)) result.historicalLineEndingVariantCount = historicalLineEndingVariantCount;
  } finally {
    if (database) {
      try { await database.$disconnect(); } catch { result = refusal("DATABASE_CLEANUP_UNVERIFIED"); }
    }
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = process.argv.length === 2
    ? await runGuardedPreviewAccessMigration() : refusal("UNEXPECTED_ARGUMENTS");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
