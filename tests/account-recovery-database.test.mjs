import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { realpathSync, readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { createAccountRecoveryService } from "../lib/account-recovery-service.mjs";
import { hashAccountRecoveryToken } from "../lib/account-recovery.mjs";

// Explicit CI selection must fail missing ownership guards, not silently skip.
const ciRequested = process.env.RUVANAS_ACCOUNT_RECOVERY_CI_TEST !== undefined;
const enabled = ciRequested || (process.env.RUN_DATABASE_TESTS === "1" && process.env.RUVANAS_ACCOUNT_RECOVERY_LOCAL_TEST === "1");
const NOW = new Date("2026-11-25T12:00:00.000Z");
const oldPassword = "SyntheticOldPassword42!", nextPassword = "SyntheticReplacement43!";
const repo = fileURLToPath(new URL("..", import.meta.url));
const CI_URL = "postgresql://recovery_ci:recovery_ci@127.0.0.1:5432/ruvanas_account_recovery_ci?connection_limit=6";
const AMBIENT_DATABASE_KEYS = ["DIRECT_URL", "SHADOW_DATABASE_URL", "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD", "PGSERVICE", "PGOPTIONS"];

function ciTarget(env, { platform = process.platform, nodeVersion = process.version } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  assert.equal(env.RUVANAS_ACCOUNT_RECOVERY_CI_TEST, "1");
  for (const key of [...AMBIENT_DATABASE_KEYS, "RUVANAS_ACCOUNT_RECOVERY_LOCAL_TEST", "RUVANAS_ACCOUNT_RECOVERY_CLUSTER_DIR"])
    assert.equal(env[key], undefined, "CI cannot adopt an ambient or local database target.");
  assert.equal(platform, "linux"); assert.match(nodeVersion, /^v20\./);
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
    GITHUB_JOB: "account-recovery-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
    RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false" })) assert.equal(env[key], value);
  assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
  assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
  assert.equal(env.DATABASE_URL, CI_URL); assert.equal(env.RUVANAS_ACCOUNT_RECOVERY_DATABASE_URL, CI_URL);
  return { mode: "CI", url: new URL(CI_URL) };
}

function verifyCiIdentity(identity) {
  assert.equal(identity.directory, "/var/lib/postgresql/data");
  assert.equal(identity.database, "ruvanas_account_recovery_ci"); assert.equal(identity.role, "recovery_ci");
  assert.equal(identity.port, 5432); assert.ok(identity.version >= 160000 && identity.version < 170000);
  // PostgreSQL reports its container interface; the approved connection above
  // is still the exact forwarded loopback port of this one disposable job.
  assert.equal(typeof identity.host, "string"); assert.notEqual(isIP(identity.host), 0);
}

function target() {
  if (ciRequested) {
    const owned = ciTarget(process.env);
    assert.deepEqual(readdirSync(repo).filter(name => /^\.env(?:\.|$)/i.test(name) && !/\.(?:example|sample|template)$/i.test(name)), []);
    return owned;
  }
  assert.equal(process.env.RUN_DATABASE_TESTS, "1");
  assert.equal(process.env.RUVANAS_ACCOUNT_RECOVERY_LOCAL_TEST, "1");
  assert.match(process.version, /^v20\./);
  for (const key of ["DIRECT_URL", "SHADOW_DATABASE_URL", "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD", "PGSERVICE", "PGOPTIONS"])
    assert.equal(process.env[key], undefined, "No ambient database routing is allowed.");
  assert.deepEqual(readdirSync(repo).filter(name => /^\.env(?:\.|$)/i.test(name) && !/\.(?:example|sample|template)$/i.test(name)), []);
  const url = new URL(process.env.RUVANAS_ACCOUNT_RECOVERY_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "recovery_qa"); assert.equal(url.password, "");
  assert.equal(url.pathname, "/ruvanas_account_recovery"); assert.equal(url.search, "?connection_limit=6");
  assert.ok(Number(url.port) > 1024 && Number(url.port) < 65536);
  assert.equal(process.env.DATABASE_URL, url.href);
  const cluster = realpathSync(process.env.RUVANAS_ACCOUNT_RECOVERY_CLUSTER_DIR);
  assert.match(cluster.replaceAll("\\", "/"), /\/output\/account-recovery-local-20261125\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

const ciEnvironment = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_ACCOUNT_RECOVERY_CI_TEST: "1",
  DATABASE_URL: CI_URL, RUVANAS_ACCOUNT_RECOVERY_DATABASE_URL: CI_URL,
  GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI", GITHUB_JOB: "account-recovery-database",
  RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", GITHUB_REPOSITORY: "synthetic/repository",
  GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", RUVANAS_RETAIL_REWARDS_ENABLED: "false",
  RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false" });
const ciRuntime = { platform: "linux", nodeVersion: "v20.20.2" };

test("recovery CI guard admits only the exact GitHub-hosted Node20 job and disposable target", () => {
  const accepted = ciTarget(ciEnvironment(), ciRuntime);
  assert.equal(accepted.mode, "CI"); assert.equal(accepted.url.href, CI_URL);
  const mutations = [
    { RUN_DATABASE_TESTS: "0" }, { RUVANAS_ACCOUNT_RECOVERY_CI_TEST: undefined }, { RUVANAS_ACCOUNT_RECOVERY_CI_TEST: "true" },
    { RUVANAS_ACCOUNT_RECOVERY_LOCAL_TEST: "1" }, { RUVANAS_ACCOUNT_RECOVERY_CLUSTER_DIR: "/tmp/other" },
    { GITHUB_ACTIONS: undefined }, { CI: "false" }, { GITHUB_WORKFLOW: "Other workflow" },
    { GITHUB_JOB: "validate" }, { GITHUB_JOB: "rewards-wallet-database" }, { RUNNER_ENVIRONMENT: "self-hosted" },
    { RUNNER_OS: "Windows" }, { GITHUB_REPOSITORY: "invalid" }, { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ATTEMPT: "0" },
    { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, { RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "true" },
    { DATABASE_URL: undefined }, { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.invalid") },
    { DATABASE_URL: CI_URL.replace("recovery_ci:recovery_ci", "postgres:password") },
    { DATABASE_URL: CI_URL.replace(":5432", ":5433") }, { RUVANAS_ACCOUNT_RECOVERY_DATABASE_URL: CI_URL + "&schema=public" },
    ...AMBIENT_DATABASE_KEYS.map(key => ({ [key]: "unapproved-routing" }))
  ];
  for (const patch of mutations) assert.throws(() => ciTarget({ ...ciEnvironment(), ...patch }, ciRuntime), JSON.stringify(patch));
  assert.throws(() => ciTarget(ciEnvironment(), { ...ciRuntime, platform: "win32" }));
  assert.throws(() => ciTarget(ciEnvironment(), { ...ciRuntime, nodeVersion: "v22.0.0" }));
});

test("recovery CI verifies the connected service identity before creating fixtures", () => {
  const identity = { directory: "/var/lib/postgresql/data", database: "ruvanas_account_recovery_ci",
    role: "recovery_ci", port: 5432, version: 160016, host: "172.17.0.2" };
  assert.doesNotThrow(() => verifyCiIdentity(identity));
  for (const patch of [{ directory: "/production" }, { database: "ruvanas" }, { role: "postgres" },
    { port: 5433 }, { version: 150000 }, { version: 170000 }, { host: "" }, { host: "production.invalid" }]) {
    assert.throws(() => verifyCiIdentity({ ...identity, ...patch }));
  }
});

test("explicit recovery CI selection fails missing ownership instead of skipping the actual database test", async () => {
  const env = {};
  for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "PATH", "Path", "PATHEXT"])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  Object.assign(env, { RUVANAS_ACCOUNT_RECOVERY_CI_TEST: "1", RUN_DATABASE_TESTS: "0", NO_COLOR: "1" });
  let result;
  try {
    await promisify(execFile)(process.execPath, ["--test", "--test-reporter=tap", "--test-name-pattern", "^account recovery on owned Node20/PostgreSQL16 database$",
      "tests/account-recovery-database.test.mjs"], { cwd: repo, env, windowsHide: true, timeout: 30000 });
  } catch (error) { result = error; }
  assert.equal(result?.code, 1);
  assert.match(result.stdout, /not ok \d+ - account recovery on owned Node20\/PostgreSQL16 database/);
  assert.match(result.stdout, /# fail 1/);
  assert.doesNotMatch(result.stdout, /account recovery on owned Node20\/PostgreSQL16 database[^\n]*# SKIP/);
});

test("workflow runs recovery concurrency tests on a dedicated PostgreSQL16 service without starting the application", () => {
  const yaml = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = yaml.split("  account-recovery-database:")[1]?.split(/\r?\n  [A-Za-z0-9_-]+:\r?\n/)[0];
  assert.ok(job); assert.equal((job.match(/image: postgres:16/g) || []).length, 1);
  assert.match(job, /node-version: 20/); assert.match(job, /RUVANAS_ACCOUNT_RECOVERY_CI_TEST: "1"/);
  assert.match(job, /npx prisma migrate deploy/); assert.match(job, /npx prisma migrate status/);
  assert.match(job, /run: node --test --test-concurrency=1 tests\/account-recovery-database\.test\.mjs/);
  assert.match(job, /RUVANAS_RETAIL_REWARDS_ENABLED: "false"/);
  assert.match(job, /RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false"/);
  assert.equal((job.match(new RegExp(CI_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 2);
  assert.doesNotMatch(job, /npm start|npm run start|\bsecrets\./);
});

async function fixture(db) {
  const id = `recovery_${randomUUID().replaceAll("-", "")}`;
  const organisation = await db.organisation.create({ data: { name: "Synthetic recovery shop", slug: id } });
  const user = await db.user.create({ data: { email: `${id}@example.invalid`, role: "OWNER", passwordHash: await bcrypt.hash(oldPassword, 4) } });
  const member = await db.organisationMember.create({ data: { userId: user.id, organisationId: organisation.id, role: "OWNER" } });
  const sessions = await Promise.all([0, 1].map(index => db.session.create({ data: { userId: user.id,
    activeOrganisationId: organisation.id, tokenHash: createHash("sha256").update(`${id}-${index}`).digest("hex"),
    expiresAt: new Date(+NOW + 3_600_000) } })));
  const env = {
    NODE_ENV: "test", RUVANAS_ENVIRONMENT: "LOCAL_SYNTHETIC_PRIVATE_PREVIEW", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.invalid", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.invalid",
    RUVANAS_PUBLIC_URL: "http://127.0.0.1:3099", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/",
    RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ENABLED: "true",
    RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ACCOUNTS: JSON.stringify([{ userId: user.id, organisationId: organisation.id, email: user.email }]),
    RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_EXPIRES_AT: new Date(+NOW + 7_200_000).toISOString(),
    RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "false",
    RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "false", RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "false",
    RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "false",
    NOTIFICATION_EMAIL_ENDPOINT: "https://mail.example.invalid/send", NOTIFICATION_EMAIL_TOKEN: "synthetic-provider-token-never-sent-42",
    NOTIFICATION_EMAIL_FROM: "security@example.invalid"
  };
  const messages = [], logs = [];
  let now = new Date(NOW);
  const options = { db, env, clock: () => new Date(now), log: code => logs.push(code),
    sendEmail: async ({ recovery }) => { messages.push(recovery); return { configured: true, delivered: true }; } };
  return { user, organisation, member, sessions, env, messages, logs, options,
    setNow(value) { now = new Date(value); }, service: createAccountRecoveryService(options) };
}
const request = f => f.service.request({ email: f.user.email }, { requestUrl: "http://127.0.0.1:3099/api/auth/password-recovery/request", requestId: "synthetic-request" });
const tokenFrom = message => new URLSearchParams(new URL(message.resetUrl).hash.slice(1)).get("token");
const reset = (service, token, password = nextPassword) => service.reset({ token, password, confirmation: password }, { requestId: "synthetic-reset" });
async function unchangedAccount(db, f) {
  const user = await db.user.findUnique({ where: { id: f.user.id } });
  assert.equal(user.passwordHash, f.user.passwordHash);
  assert.equal(await db.session.count({ where: { userId: f.user.id, revokedAt: null } }), 2);
}
async function untouchedTableDigests(db) {
  const expected = new Set(["User", "Organisation", "OrganisationMember", "Session", "PasswordResetToken", "AuditLog", "EnterpriseSecurityPolicy", "PrivatePreviewAccess"]);
  const rows = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const tables = rows.map(row => row.tablename).filter(name => !expected.has(name));
  const out = {};
  for (const name of tables) {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    const [result] = await db.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text, CHR(10) ORDER BY row_to_json(t)::text), '')) AS digest FROM "${name}" t`);
    out[name] = result.digest;
  }
  return out;
}

test("account recovery on owned Node20/PostgreSQL16 database", { skip: !enabled }, async t => {
  const owned = target();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: owned.url.href });
  try {
    const [identity] = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    if (owned.mode === "CI") verifyCiIdentity(identity);
    else {
      assert.equal(path.resolve(identity.directory).toLowerCase(), path.resolve(owned.cluster).toLowerCase());
      assert.equal(identity.database, "ruvanas_account_recovery"); assert.equal(identity.role, "recovery_qa");
      assert.equal(identity.host, "127.0.0.1"); assert.equal(identity.port, Number(owned.url.port));
      assert.ok(identity.version >= 160000 && identity.version < 170000);
    }
    const untouchedBefore = await untouchedTableDigests(db);

    await t.test("reset changes only the target account, revokes its sessions, and rejects replay", async () => {
      const f = await fixture(db), other = await fixture(db);
      assert.equal((await request(f)).ok, true); assert.equal(f.messages.length, 1);
      const token = tokenFrom(f.messages[0]);
      const saved = await db.passwordResetToken.findUnique({ where: { tokenHash: hashAccountRecoveryToken(token) } });
      assert.ok(saved); assert.notEqual(saved.tokenHash, token);
      const result = await reset(f.service, token);
      assert.equal(result.ok, true); assert.equal(result.destination, null, "Rewards remains closed after reset");
      const current = await db.user.findUnique({ where: { id: f.user.id } });
      assert.equal(await bcrypt.compare(nextPassword, current.passwordHash), true);
      assert.equal(current.role, f.user.role);
      assert.equal(await db.session.count({ where: { userId: f.user.id, revokedAt: null } }), 0);
      assert.equal(await db.session.count({ where: { userId: f.user.id } }), 2, "No session created");
      assert.equal(await db.passwordResetToken.count({ where: { userId: f.user.id, usedAt: null } }), 0);
      assert.equal((await reset(f.service, token, "AnotherSyntheticPassword44!")).ok, false);
      await unchangedAccount(db, other);
      const audits = await db.auditLog.findMany({ where: { actorUserId: f.user.id } });
      assert.deepEqual(audits.map(row => row.action).sort(), ["ACCOUNT_RECOVERY_COMPLETED", "ACCOUNT_RECOVERY_REQUESTED"]);
      const serialized = JSON.stringify(audits);
      for (const secret of [token, oldPassword, nextPassword, f.messages[0].resetUrl]) assert.equal(serialized.includes(secret), false);
    });

    await t.test("two concurrent resets consume a token exactly once", async () => {
      const f = await fixture(db); await request(f); const token = tokenFrom(f.messages[0]);
      let arrivals = 0, release;
      const barrier = new Promise(resolve => { release = resolve; });
      const service = createAccountRecoveryService({ ...f.options, hashPassword: async password => {
        const hash = await bcrypt.hash(password, 4); if (++arrivals === 2) release(); await barrier; return hash;
      } });
      const results = await Promise.all([reset(service, token), reset(service, token, "OtherSyntheticReplacement44!")]);
      assert.equal(results.filter(result => result.ok).length, 1);
      assert.equal(await db.auditLog.count({ where: { actorUserId: f.user.id, action: "ACCOUNT_RECOVERY_COMPLETED" } }), 1);
      assert.equal(await db.passwordResetToken.count({ where: { userId: f.user.id, usedAt: null } }), 0);
    });

    await t.test("competing requests leave only one usable recovery token", async () => {
      const f = await fixture(db);
      const results = await Promise.all([request(f), request(f)]);
      assert.ok(results.every(result => result.ok)); assert.equal(f.messages.length, 2);
      const tokens = await db.passwordResetToken.findMany({ where: { userId: f.user.id } });
      assert.equal(tokens.length, 2); assert.equal(tokens.filter(row => row.usedAt === null).length, 1);
      const invalid = tokens.find(row => row.usedAt !== null);
      const message = f.messages.find(item => hashAccountRecoveryToken(tokenFrom(item)) === invalid.tokenHash);
      assert.equal((await reset(f.service, tokenFrom(message))).ok, false);
      await unchangedAccount(db, f);
    });

    await t.test("expiry during password hashing is checked again before mutation", async () => {
      const f = await fixture(db); await request(f); const token = tokenFrom(f.messages[0]);
      const service = createAccountRecoveryService({ ...f.options, hashPassword: async password => {
        const hash = await bcrypt.hash(password, 4); f.setNow(new Date(+NOW + 1_800_001)); return hash;
      } });
      assert.equal((await reset(service, token)).ok, false); await unchangedAccount(db, f);
    });

    await t.test("recovery access expiry during hashing cannot change the password", async () => {
      const f = await fixture(db); f.env.RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_EXPIRES_AT = new Date(+NOW + 60_000).toISOString();
      await request(f); const token = tokenFrom(f.messages[0]);
      const service = createAccountRecoveryService({ ...f.options, hashPassword: async password => {
        const hash = await bcrypt.hash(password, 4); f.setNow(new Date(+NOW + 60_001)); return hash;
      } });
      assert.equal((await reset(service, token)).ok, false); await unchangedAccount(db, f);
    });

    await t.test("membership scope removed during hashing prevents reset", async () => {
      const f = await fixture(db); await request(f); const token = tokenFrom(f.messages[0]);
      const service = createAccountRecoveryService({ ...f.options, hashPassword: async password => {
        const hash = await bcrypt.hash(password, 4);
        await db.organisationMember.update({ where: { id: f.member.id }, data: { role: "VIEWER" } }); return hash;
      } });
      assert.equal((await reset(service, token)).ok, false); await unchangedAccount(db, f);
    });

    await t.test("SSO-only policy inserted during hashing prevents reset", async () => {
      const f = await fixture(db); await request(f); const token = tokenFrom(f.messages[0]);
      const service = createAccountRecoveryService({ ...f.options, hashPassword: async password => {
        const hash = await bcrypt.hash(password, 4);
        await db.enterpriseSecurityPolicy.create({ data: { organisationId: f.organisation.id, ssoRequired: true, passwordFallback: false } }); return hash;
      } });
      assert.equal((await reset(service, token)).ok, false); await unchangedAccount(db, f);
    });

    await t.test("a token sent before the account email changes cannot reset that account", async () => {
      const f = await fixture(db); await request(f); const token = tokenFrom(f.messages[0]);
      await db.user.update({ where: { id: f.user.id }, data: { email: `changed_${randomUUID()}@example.invalid` } });
      assert.equal((await reset(f.service, token)).ok, false); await unchangedAccount(db, f);
      assert.equal(await db.auditLog.count({ where: { actorUserId: f.user.id, action: "ACCOUNT_RECOVERY_COMPLETED" } }), 0);
    });

    await t.test("unconfigured delivery is account-independent and leaves no tokens", async () => {
      const f = await fixture(db); delete f.env.NOTIFICATION_EMAIL_TOKEN;
      const eligible = await request(f);
      const absent = await f.service.request({ email: "unknown@example.invalid" }, { requestUrl: "http://127.0.0.1:3099" });
      assert.deepEqual(eligible, absent); assert.equal(eligible.code, "DELIVERY_UNAVAILABLE");
      assert.equal(f.messages.length, 0); assert.equal(await db.passwordResetToken.count({ where: { userId: f.user.id } }), 0);
      await unchangedAccount(db, f);
    });

    await t.test("failed or unaccepted delivery invalidates generated links without exposing account existence", async () => {
      for (const throws of [false, true]) {
        const f = await fixture(db);
        f.service = createAccountRecoveryService({ ...f.options, sendEmail: async ({ recovery }) => {
          f.messages.push(recovery); if (throws) throw new Error("Synthetic provider unavailable");
          return { configured: true, delivered: false };
        } });
        const response = await request(f);
        const unknown = await f.service.request({ email: "unknown@example.invalid" }, { requestUrl: "http://127.0.0.1:3099" });
        assert.deepEqual(response, unknown); assert.equal(f.messages.length, 1);
        assert.equal(await db.passwordResetToken.count({ where: { userId: f.user.id, usedAt: null } }), 0);
        assert.equal((await reset(f.service, tokenFrom(f.messages[0]))).ok, false); await unchangedAccount(db, f);
      }
    });

    await t.test("an unrelated ordinary account and a preview tester cannot obtain recovery tokens", async () => {
      const f = await fixture(db), unrelated = await fixture(db);
      const unknownResponse = await f.service.request({ email: "unknown@example.invalid" }, { requestUrl: "http://127.0.0.1:3099" });
      assert.deepEqual(await f.service.request({ email: unrelated.user.email }, { requestUrl: "http://127.0.0.1:3099" }), unknownResponse);
      await db.privatePreviewAccess.create({ data: { userId: f.user.id, organisationId: f.organisation.id, pillars: ["retail"], enabled: true } });
      assert.deepEqual(await request(f), unknownResponse); assert.equal(f.messages.length, 0);
      assert.equal(await db.passwordResetToken.count({ where: { userId: { in: [f.user.id, unrelated.user.id] } } }), 0);
      await unchangedAccount(db, f); await unchangedAccount(db, unrelated);
    });

    await t.test("no Rewards, subscriptions, media, channels, registration or other tables are changed", async () => {
      assert.deepEqual(await untouchedTableDigests(db), untouchedBefore);
    });
  } finally { await db.$disconnect(); }
});
