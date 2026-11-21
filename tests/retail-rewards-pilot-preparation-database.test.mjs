import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_PILOT_PREPARATION_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const BEFORE = new Date("2026-11-18T12:00:00.000Z"), EXPIRED = new Date("2026-11-18T13:00:00.000Z"), NOW = new Date("2026-11-19T12:00:00.000Z");
const HASH = `$2b$12$${"a".repeat(53)}`;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
// Fail closed before constructing Prisma: neither mode discovers an application
// database or accepts an inherited connection URL.
export function pilotPreparationDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  assert.equal(env.RUVANAS_RETAIL_REWARDS_ENABLED, "false");
  assert.equal(env.RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED, "false");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_PILOT_PREPARATION_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_PILOT_RENEWAL_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined);
    assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
      GITHUB_JOB: "rewards-pilot-renewal-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/); assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.equal(env.DATABASE_URL, CI_URL); assert.equal(env.RUVANAS_REWARDS_DATABASE_URL, CI_URL);
    return { mode: "CI", url: new URL(CI_URL) };
  }
  assert.equal(env.RUVANAS_REWARDS_PILOT_PREPARATION_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.username, "local_fixture");
  assert.equal(url.password, ""); assert.equal(url.hash, ""); assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.equal(url.pathname, "/rewards_pilot_preparation_fixture");
  assert.equal(url.search, "?schema=public&connection_limit=6&pool_timeout=10"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR); assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/(?:retail-rewards-pilot-preparation-20261119|retail-rewards-pilot-preparation-review-20261121)\/pg-[0-9]+-[a-f0-9]{6}\/cluster$/);
  return { mode: "LOCAL", url, cluster };
}
export async function openPilotPreparationDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = pilotPreparationDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const identity = rows[0];
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "local_fixture"); assert.equal(identity.host, "127.0.0.1"); assert.ok(samePath(identity.directory, target.cluster));
    }
    assert.ok(identity.version >= 160000 && identity.version < 170000);
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}
test("preparation database guard rejects every unrelated target before constructing Prisma", async () => {
  const url = "postgresql://local_fixture@127.0.0.1:55432/rewards_pilot_preparation_fixture?schema=public&connection_limit=6&pool_timeout=10";
  const env = { RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_PILOT_PREPARATION_LOCAL_TEST: "1", DATABASE_URL: url, RUVANAS_REWARDS_DATABASE_URL: url,
    RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false",
    RUVANAS_REWARDS_CLUSTER_DIR: path.resolve("output/retail-rewards-pilot-preparation-20261119/pg-123-abcdef/cluster") };
  assert.equal(pilotPreparationDatabaseTarget(env, { realpath: value => value }).url.href, url);
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_PILOT_PREPARATION_LOCAL_TEST: "true" }, { RUVANAS_REWARDS_CI_TEST: "1" },
    { RUVANAS_REWARDS_CLUSTER_DIR: path.resolve("output/unrelated/cluster") }, { DATABASE_URL: undefined },
    ...[url.replace("127.0.0.1", "localhost"), url.replace("local_fixture@", "local_fixture:secret@"), url.replace("preparation_fixture", "production"),
      `${url}&extra=value`, url.replace("connection_limit=6", "connection_limit=9")].map(value => ({ DATABASE_URL: value, RUVANAS_REWARDS_DATABASE_URL: value }))]) {
    let clients = 0; await assert.rejects(openPilotPreparationDatabase({ ...env, ...patch }, { realpath: value => value, createClient: () => { clients++; } })); assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openPilotPreparationDatabase(env, { realpath: value => value, createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) })); assert.equal(disconnected, 1);
});

const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-pilot-renewal-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
  RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false" });

test("preparation CI guard accepts only the pinned disposable GitHub PostgreSQL16 service", async () => {
  assert.equal(pilotPreparationDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_PILOT_PREPARATION_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_PILOT_RENEWAL_LOCAL_TEST: "1" },
    { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/foreign" }, { GITHUB_ACTIONS: "false" }, { GITHUB_JOB: "rewards-database" },
    { RUNNER_ENVIRONMENT: "self-hosted" }, { RUNNER_OS: "Windows" }, { GITHUB_WORKFLOW: "Deploy" }, { CI: "false" },
    { GITHUB_REPOSITORY: "malformed" }, { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ATTEMPT: "0" },
    { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, { RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "true" },
    { DATABASE_URL: undefined }, { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openPilotPreparationDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  for (const platform of ["win32", "darwin"]) assert.throws(() => pilotPreparationDatabaseTarget(ciEnv(), { platform }));
  const identity = { directory: "/var/lib/postgresql/data", database: "ruvanas_rewards_ci", role: "rewards_ci", host: "172.18.0.2", port: 5432, version: 160016 };
  for (const patch of [{ directory: "/production" }, { database: "ruvanas" }, { role: "postgres" }, { port: 5433 }, { version: 150016 }, { version: 170000 }, { host: "" }]) {
    let disconnected = 0;
    await assert.rejects(openPilotPreparationDatabase(ciEnv(), { platform: "linux", createClient: () => ({
      $queryRawUnsafe: async () => [{ ...identity, ...patch }], $disconnect: async () => { disconnected++; }
    }) }));
    assert.equal(disconnected, 1);
  }
  const opened = await openPilotPreparationDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [identity], $disconnect: async () => {}
  }) });
  assert.equal(opened.target.mode, "CI");
});

const sessionInclude = { user: { include: { privatePreviewAccess: true } }, activeOrganisation: { include: { enterpriseSecurityPolicy: true } } };
async function fixture(db) {
  const prefix = `pilotprep-${randomUUID().replaceAll("-", "")}`;
  const admin = await db.user.create({ data: { name: "Synthetic Super Admin", email: `${prefix}-admin@example.invalid`, passwordHash: HASH, role: "SUPER_ADMIN" } });
  const session = await db.session.create({ data: { userId: admin.id, tokenHash: randomBytes(32).toString("hex"), authMethod: "PASSWORD",
    createdAt: new Date(+BEFORE - 60000), lastSeenAt: BEFORE, expiresAt: new Date(+NOW + 14400000) } });
  const loadSession = client => client.session.findUnique({ where: { id: session.id }, include: sessionInclude });
  const plan = await db.plan.create({ data: { name: "Synthetic preparation plan", code: prefix.toUpperCase(), active: true, publiclyAvailable: true,
    productFamily: "RETAIL", retailRadioEnabled: true, monthlyPriceCents: 0, stationLimit: 1, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128 } });
  const { createOrdinaryOwnerService } = await import("../lib/ordinary-owner-provisioning.mjs");
  const ordinary = createOrdinaryOwnerService({ db, loadSession: () => loadSession(db), env: {}, clock: () => BEFORE, hashPassword: async () => HASH });
  const created = await ordinary.create({ name: "Synthetic Rewards Preparation Shop", slug: prefix, planId: plan.id, ownerName: "Synthetic Client Admin",
    ownerEmail: `${prefix}-owner@example.invalid`, password: "Local-fixture-only-password", confirmCreate: true });
  assert.equal(created.ok, true, created.code);
  const organisationId = created.organisation.id, subscription = await db.subscription.findUnique({ where: { organisationId } });
  const program = await db.rewardProgram.create({ data: { organisationId, status: "ACTIVE", networkOptIn: true, timezone: "Europe/Malta" } });
  await db.rewardEntitlementGrant.create({ data: { organisationId, subscriptionId: subscription.id, tier: "REWARDS_STARTER", status: "TRIAL",
    startsAt: new Date(+BEFORE - 3600000), expiresAt: EXPIRED, activeOffers: 3, locations: 1, staffSeats: 1, monthlyRedemptions: 4,
    analyticsRetentionDays: 7, exportEnabled: false, brandingEnabled: false } });
  const location = await db.location.create({ data: { organisationId, name: "Synthetic active shop", slug: prefix, timezone: "Europe/Malta", countryCode: "MT", status: "ACTIVE" } });
  await db.zone.create({ data: { locationId: location.id, name: "Main Store", slug: "main-store", status: "ACTIVE" } });
  const { createDormantShopperService } = await import("../lib/dormant-shopper-provisioning.mjs");
  const email = `${prefix}-shopper@example.invalid`;
  const prepared = await createDormantShopperService({ db, loadSession: () => loadSession(db), clock: () => BEFORE,
    env: { RUVANAS_RETAIL_REWARDS_ENABLED: "false" } }).create({ organisationId, email, displayName: "Synthetic disabled shopper", confirmCreate: true });
  assert.equal(prepared.ok, true, prepared.code);
  const shopperId = prepared.shopper.id, setup = await db.rewardShopperSetup.findUnique({ where: { shopperId } });
  const { createRewardPilotAdminService } = await import("../lib/retail-rewards/pilot-admin-service.mjs");
  const fixtureEnv = { RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: admin.email, RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: admin.email,
    RUVANAS_PUBLIC_URL: "http://127.0.0.1:3999", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/", RUVANAS_RETAIL_REWARDS_ENABLED: "true",
    RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
    RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: JSON.stringify([organisationId]),
    SESSION_SECRET: "synthetic-preparation-fixture-only-secret-never-live" };
  const api = createRewardPilotAdminService({ db, env: fixtureEnv, clock: () => BEFORE, loadContext: async client => {
    const stored = await loadSession(client); return { session: stored, user: stored?.user };
  } });
  const invitation = await api.invitePrepared({ organisationId, shopperId, email, authVersion: 1, preparedAt: setup.createdAt.toISOString(), expiresAt: EXPIRED.toISOString(), confirm: true });
  assert.equal(invitation.ok, true, invitation.code);
  assert.equal((await api.revoke({ organisationId, shopperId, confirm: true })).ok, true);
  const foreign = await db.organisation.create({ data: { name: "Unrelated synthetic tenant", slug: `${prefix}-foreign` } });
  const paid = await ordinary.create({ name: "Synthetic non-trial tenant", slug: `${prefix}-paid`, planId: plan.id, ownerName: "Other Client Admin",
    ownerEmail: `${prefix}-paid-owner@example.invalid`, password: "Local-fixture-only-password", confirmCreate: true });
  assert.equal(paid.ok, true, paid.code);
  await db.subscription.update({ where: { organisationId: paid.organisation.id }, data: { status: "ACTIVE" } });
  await db.session.update({ where: { id: session.id }, data: { lastSeenAt: NOW } });
  return { organisationId, shopperId, programId: program.id, foreignId: foreign.id, paidId: paid.organisation.id, loadSession };
}
async function digest(db) {
  // This is the newly owned, verified fixture database. Return only per-table
  // counts/digests, never row bodies, credentials or generated invitation data.
  const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result = {};
  for (const { tablename } of tables) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    const rows = await db.$queryRawUnsafe(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(row_to_json(t)::text, chr(10) ORDER BY row_to_json(t)::text), '')) AS digest FROM "public".${quoted} AS t`);
    result[tablename] = rows[0];
  }
  return result;
}
test("real PostgreSQL16 preparation reads exact test scope with Rewards off and leaves every row unchanged", { skip: !requested }, async t => {
  const { db } = await openPilotPreparationDatabase(process.env);
  try {
    const f = await fixture(db), before = await digest(db);
    const { createPilotPreparationService } = await import("../lib/retail-rewards/pilot-preparation-service.mjs");
    const env = { RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false" };
    const service = createPilotPreparationService({ db, env, loadSession: () => f.loadSession(db), clock: () => NOW });
    await t.test("real Prisma projections accept existing ordinary-owner and disabled-shopper provenance", async () => {
      const result = await service.inspect({ organisationId: f.organisationId });
      assert.equal(result.ok, true, result.code); assert.equal(result.rewardsEnabled, false); assert.equal(result.readiness.eligibleNow, false);
      assert.deepEqual(result.preparedShoppers, { total: 1, disabled: 1, active: 0, suspended: 0, enrolled: 1, expiredMemberships: 1, revokedInvitations: 1 });
      assert.equal(result.readiness.checks[1].code, "OWNER_READY"); assert.equal(result.readiness.checks[2].code, "ENTITLEMENT_INACTIVE");
      assert.equal(result.endToEndTest, "NOT_VERIFIED"); assert.doesNotMatch(JSON.stringify(result), /password|token|fingerprint|authVersion|emailCanonical/i);
    });
    await t.test("foreign and non-trial targets return no tenant snapshot", async () => {
      for (const organisationId of [f.foreignId, f.paidId]) {
        const result = await service.inspect({ organisationId }); assert.equal(result.ok, false); assert.equal(result.code, "PREPARATION_UNAVAILABLE");
        assert.equal(result.organisation, undefined);
      }
    });
    await t.test("master feature transition refuses preparation without activating anything", async () => {
      const enabled = createPilotPreparationService({ db, env: { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, loadSession: () => f.loadSession(db), clock: () => NOW });
      assert.equal((await enabled.inspect({ organisationId: f.organisationId })).code, "PREPARATION_UNAVAILABLE");
    });
    await t.test("all public tables retain identical row counts and content digests", async () => { assert.deepEqual(await digest(db), before); });
  } finally { await db.$disconnect(); }
});
