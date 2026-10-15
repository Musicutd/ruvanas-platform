import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  decidePreviewAccessMigration, PREVIEW_ACCESS_MIGRATION, PREVIEW_ACCESS_MIGRATION_CHECKSUM,
  privatePreviewAccessMigrationPreflight, readPreviewMigrationCatalog, runGuardedPreviewAccessMigration as runGuardedMigration
} from "../scripts/private-preview-access-migrate.mjs";
import { runPreviewAccountDatabaseAcceptance } from "../scripts/private-preview-account-db-acceptance.mjs";

function runGuardedPreviewAccessMigration(options) {
  return runGuardedMigration({ acceptance: async () => ({ ok: true, status: "ROLLED_BACK_PASS" }), ...options });
}

const ENV = {
  RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW", RENDER_SERVICE_ID: "srv-da03b5lbedkc739q74k0",
  RUVANAS_PUBLIC_URL: "https://ruvanas-platform.onrender.com",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test",
  RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
  RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST: "dpg-db5kurijnfac73arripg-a",
  RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME: "ruvanas_private_preview_20261011",
  DATABASE_URL: "postgresql://synthetic:never-display-this@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011?schema=public"
};
const OLD = { name: "20260101000000_synthetic_history", checksum: "a".repeat(64) };
const NEW = { name: PREVIEW_ACCESS_MIGRATION, checksum: PREVIEW_ACCESS_MIGRATION_CHECKSUM };
const row = (entry, overrides = {}) => ({ migration_name: entry.name, checksum: entry.checksum,
  finished_at: new Date("2026-10-14T00:00:00Z"), rolled_back_at: null, ...overrides });

test("preflight accepts only the existing paid preview host and exact isolated database", () => {
  assert.deepEqual(privatePreviewAccessMigrationPreflight(ENV), { ok: true });
  const withoutWitnesses = { ...ENV };
  delete withoutWitnesses.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST;
  delete withoutWitnesses.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME;
  assert.deepEqual(privatePreviewAccessMigrationPreflight(withoutWitnesses), { ok: true });
  for (const [key, value] of [["RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST", "wrong-host"],
    ["RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME", "wrong-database"],
    ["DATABASE_URL", ENV.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "wrong-host")],
    ["DATABASE_URL", ENV.DATABASE_URL.replace("/ruvanas_private_preview_20261011", "/wrong-database")]]) {
    assert.equal(privatePreviewAccessMigrationPreflight({ ...withoutWitnesses, [key]: value }).ok, false);
  }
  for (const [key, value] of [["RUVANAS_ENVIRONMENT", "PRODUCTION"], ["RENDER_SERVICE_ID", "srv-other"],
    ["RUVANAS_PUBLIC_URL", "https://ruvanas-private-preview-20261011.onrender.com"],
    ["RUVANAS_PUBLIC_URL", "https://ruvanas-platform.onrender.com/"],
    ["RUVANAS_PRIVATE_PREVIEW_ENABLED", "0"], ["RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL", "other@example.test"],
    ["RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST", "production-host"],
    ["RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME", "production"],
    ["DATABASE_URL", ENV.DATABASE_URL.replace("ruvanas_private_preview_20261011", "production")],
    ["DATABASE_URL", ENV.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "production-host")],
    ["DATABASE_URL", `${ENV.DATABASE_URL}&schema=public`],
    ["DATABASE_URL", `${ENV.DATABASE_URL}&options=unreviewed`]]) {
    const result = privatePreviewAccessMigrationPreflight({ ...ENV, [key]: value });
    assert.equal(result.ok, false, key);
    assert.doesNotMatch(JSON.stringify(result), /never-display-this|postgresql:/);
  }
});

test("TLS and schema cannot be weakened through URL or process environment", () => {
  for (const values of [
    { DATABASE_URL: `${ENV.DATABASE_URL}&sslmode=disable` },
    { DATABASE_URL: `${ENV.DATABASE_URL}&sslmode=prefer` },
    { DATABASE_URL: `${ENV.DATABASE_URL}&sslaccept=accept_invalid_certs` },
    { DATABASE_URL: ENV.DATABASE_URL.replace("schema=public", "schema=private") },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { PGSSLMODE: "disable" }
  ]) assert.equal(privatePreviewAccessMigrationPreflight({ ...ENV, ...values }).ok, false);
  assert.equal(privatePreviewAccessMigrationPreflight({ ...ENV,
    DATABASE_URL: `${ENV.DATABASE_URL}&sslmode=require&sslaccept=strict`
  }).ok, true);
});

test("only the pinned additive table may be pending; exact already-applied checksum is idempotent", () => {
  assert.deepEqual(decidePreviewAccessMigration([OLD, NEW], [row(OLD)]),
    { ok: true, action: "DEPLOY", migrationCount: 2 });
  assert.deepEqual(decidePreviewAccessMigration([OLD, NEW], [row(OLD), row(NEW)]),
    { ok: true, action: "ALREADY_APPLIED", migrationCount: 2 });
  assert.equal(decidePreviewAccessMigration([OLD, NEW], []).code, "OTHER_PENDING_MIGRATION");
  assert.equal(decidePreviewAccessMigration([OLD], [row(OLD)]).code, "ADDITIVE_MIGRATION_CHANGED");
  assert.equal(decidePreviewAccessMigration([OLD, { ...NEW, checksum: "b".repeat(64) }], [row(OLD)]).code,
    "ADDITIVE_MIGRATION_CHANGED");
  assert.equal(decidePreviewAccessMigration([OLD, NEW, { name: "20261206000000_unapproved", checksum: "c".repeat(64) }],
    [row(OLD)]).code, "ADDITIVE_MIGRATION_CHANGED");
});

test("unknown, failed, rolled-back, duplicated or changed database history always refuses", () => {
  for (const [history, code] of [
    [[row({ name: "20260102000000_unknown", checksum: "c".repeat(64) })], "UNKNOWN_DATABASE_MIGRATION"],
    [[row(OLD, { finished_at: null })], "MIGRATION_HISTORY_NOT_CLEAN"],
    [[row(OLD, { rolled_back_at: new Date() })], "MIGRATION_HISTORY_NOT_CLEAN"],
    [[row(OLD), row(OLD)], "DUPLICATE_DATABASE_MIGRATION"],
    [[row(OLD, { checksum: "b".repeat(64) })], "HISTORICAL_MIGRATION_CHANGED"],
    [[row(OLD), row(NEW, { checksum: "b".repeat(64) })], "HISTORICAL_MIGRATION_CHANGED"]
  ]) assert.equal(decidePreviewAccessMigration([OLD, NEW], history).code, code);
});

test("real local manifest derives every historical migration and pins only the reviewed additive SQL", async () => {
  const catalog = await readPreviewMigrationCatalog();
  assert.ok(catalog.length > 100);
  assert.equal(catalog.at(-1).name, PREVIEW_ACCESS_MIGRATION);
  assert.equal(catalog.at(-1).checksum, PREVIEW_ACCESS_MIGRATION_CHECKSUM);
  const decision = decidePreviewAccessMigration(catalog,
    catalog.filter((entry) => entry.name !== PREVIEW_ACCESS_MIGRATION).map((entry) => row(entry)));
  assert.equal(decision.action, "DEPLOY");
  assert.equal(decision.migrationCount, catalog.length);
});

async function mockDatabase({ identity = true, includeNew = false, failDisconnect = false } = {}) {
  const catalog = await readPreviewMigrationCatalog();
  let history = catalog.filter((entry) => includeNew || entry.name !== PREVIEW_ACCESS_MIGRATION).map((entry) => row(entry));
  const calls = { reads: 0, disconnects: 0, readonly: 0 };
  return {
    calls,
    apply() { history = catalog.map((entry) => row(entry)); },
    $transaction: async (operation) => operation({
      $executeRaw: async (strings) => { assert.equal(strings.join(""), "SET TRANSACTION READ ONLY"); calls.readonly++; },
      $queryRaw: async (strings) => {
        calls.reads++;
        return strings.join("").includes("current_database()")
          ? [{ databaseName: identity ? "ruvanas_private_preview_20261011" : "production", schemaName: "public" }]
          : history;
      }
    }),
    $disconnect: async () => { calls.disconnects++; if (failDisconnect) throw new Error("secret database details"); }
  };
}

test("refused preflight never opens a database or spawns a migration", async () => {
  const result = await runGuardedPreviewAccessMigration({ env: {},
    connect: () => { throw new Error("Unexpected connect"); }, deploy: () => { throw new Error("Unexpected deploy"); } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PREVIEW_HOST_REQUIRED");
});

test("guard checks SQL identity and history before deploy, then verifies the applied checksum", async () => {
  const db = await mockDatabase();
  let deployments = 0;
  const result = await runGuardedPreviewAccessMigration({ env: ENV, connect: async () => db,
    deploy: async () => { deployments++; assert.equal(db.calls.readonly, 1); db.apply(); } });
  assert.equal(result.ok, true);
  assert.equal(result.status, "APPLIED");
  assert.equal(deployments, 1);
  assert.equal(db.calls.readonly, 2);
  assert.equal(db.calls.disconnects, 1);
  assert.doesNotMatch(JSON.stringify(result), /never-display-this|postgresql:/);
});

test("already-applied guard performs no deploy, and bad identity never reaches official migration", async () => {
  const db = await mockDatabase({ includeNew: true });
  const result = await runGuardedPreviewAccessMigration({ env: ENV, connect: async () => db,
    deploy: () => { throw new Error("Unexpected deploy"); } });
  assert.equal(result.status, "ALREADY_APPLIED");
  const wrong = await mockDatabase({ identity: false });
  const rejected = await runGuardedPreviewAccessMigration({ env: ENV, connect: async () => wrong,
    deploy: () => { throw new Error("Unexpected deploy"); } });
  assert.equal(rejected.code, "DATABASE_IDENTITY_MISMATCH");
  assert.equal(wrong.calls.disconnects, 1);
});

test("unsuccessful postcheck, deploy and cleanup return only bounded safe codes", async () => {
  const db = await mockDatabase();
  const postcheck = await runGuardedPreviewAccessMigration({ env: ENV, connect: async () => db, deploy: async () => {} });
  assert.equal(postcheck.code, "MIGRATION_POSTCHECK_FAILED");
  const deployment = await runGuardedPreviewAccessMigration({ env: ENV, connect: async () => db,
    deploy: async () => { throw new Error("secret credentials or database text"); } });
  assert.equal(deployment.code, "MIGRATION_GUARD_FAILED");
  const brokenCleanup = await mockDatabase({ includeNew: true, failDisconnect: true });
  const cleanup = await runGuardedPreviewAccessMigration({ env: ENV, connect: async () => brokenCleanup });
  assert.equal(cleanup.code, "DATABASE_CLEANUP_UNVERIFIED");
  assert.doesNotMatch(JSON.stringify([postcheck, deployment, cleanup]), /secret|credentials|postgresql:/);
});

test("official Prisma is invoked directly without shell, raw output, reset, resolve or seed", async () => {
  const source = await readFile(new URL("../scripts/private-preview-access-migrate.mjs", import.meta.url), "utf8");
  assert.match(source, /REQUIRE\.resolve\("prisma\/build\/index\.js"\)/);
  assert.match(source, /spawn\(process\.execPath, \[executable, "migrate", "deploy", "--schema"/);
  assert.match(source, /shell: false, windowsHide: true, stdio: "ignore"/);
  assert.doesNotMatch(source, /"migrate", "(?:reset|resolve|dev)"|"db", "seed"|console\.(?:error|log)\(error/);
});

test("actual database account acceptance must pass and prove rollback before the deployment guard succeeds", async () => {
  const db = await mockDatabase({ includeNew: true });
  const result = await runGuardedPreviewAccessMigration({ env: ENV, connect: async () => db,
    acceptance: async () => ({ ok: false, code: "DATABASE_ACCEPTANCE_FAILED" }) });
  assert.equal(result.code, "DATABASE_ACCEPTANCE_FAILED");
  assert.equal(db.calls.disconnects, 1);
  const scope = await runPreviewAccountDatabaseAcceptance({}, { env: {} });
  assert.equal(scope.code, "DATABASE_ACCEPTANCE_SCOPE_REFUSED");
  const withoutWitnesses = { ...ENV };
  delete withoutWitnesses.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST;
  delete withoutWitnesses.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME;
  let entered = false;
  const mockAcceptanceDb = {
    $transaction: async () => { entered = true; throw new Error("Synthetic stop before fixture writes"); },
    user: { count: async () => 0 }
  };
  const optionalWitnesses = await runPreviewAccountDatabaseAcceptance(mockAcceptanceDb, { env: withoutWitnesses });
  assert.equal(entered, true);
  assert.equal(optionalWitnesses.code, "DATABASE_ACCEPTANCE_FAILED");
  for (const overrides of [{ RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST: "wrong-host" },
    { RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME: "wrong-database" },
    { DATABASE_URL: ENV.DATABASE_URL.replace("dpg-db5kurijnfac73arripg-a", "wrong-host") },
    { DATABASE_URL: ENV.DATABASE_URL.replace("/ruvanas_private_preview_20261011", "/wrong-database") }]) {
    entered = false;
    const rejected = await runPreviewAccountDatabaseAcceptance(mockAcceptanceDb, { env: { ...withoutWitnesses, ...overrides } });
    assert.equal(rejected.code, "DATABASE_ACCEPTANCE_SCOPE_REFUSED");
    assert.equal(entered, false);
  }
  const source = await readFile(new URL("../scripts/private-preview-account-db-acceptance.mjs", import.meta.url), "utf8");
  assert.match(source, /throw rollback/);
  assert.match(source, /isolationLevel: "Serializable", timeout: 60_000/);
  assert.match(source, /database\.user\.count\(\{ where: \{ email: \{ in: emails \}/);
  assert.doesNotMatch(source, /console\.|fetch\(|sendMail|process\.env\.[A-Z_]+\s*=/);
});
