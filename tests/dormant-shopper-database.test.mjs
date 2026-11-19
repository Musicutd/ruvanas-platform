import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_DORMANT_SHOPPER_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const NOW = new Date("2026-11-17T12:00:00.000Z");
const HASH = `$2b$12$${"a".repeat(53)}`;
const ENV = Object.freeze({ RUVANAS_PRIVATE_PREVIEW_ENABLED: "0", RUVANAS_RETAIL_REWARDS_ENABLED: "false",
  RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "false", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "false",
  RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false" });
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function dormantShopperDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_DORMANT_SHOPPER_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined);
    assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
      GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
    assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.equal(env.DATABASE_URL, CI_URL); assert.equal(env.RUVANAS_REWARDS_DATABASE_URL, CI_URL);
    return { mode: "CI", url: new URL(CI_URL) };
  }
  assert.equal(env.RUVANAS_DORMANT_SHOPPER_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "local_fixture"); assert.equal(url.password, ""); assert.equal(url.hash, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.equal(url.pathname, "/dormant_shopper_fixture");
  assert.equal(url.search, "?schema=public&connection_limit=6&pool_timeout=10");
  assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr07z-shopper-setup-20261117\/pg-[0-9]+-[a-f0-9]{6}\/cluster$/);
  return { mode: "LOCAL", url, cluster };
}

export async function openDormantShopperDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = dormantShopperDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    assert.ok(identity.version >= 160000 && identity.version < 170000, "This suite requires PostgreSQL 16.");
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "local_fixture"); assert.equal(identity.host, "127.0.0.1");
      assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });

test("dormant shopper database guard rejects foreign or malformed targets before opening a client", async () => {
  assert.equal(dormantShopperDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_DORMANT_SHOPPER_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/foreign" },
    { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_RUN_ID: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openDormantShopperDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openDormantShopperDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) }));
  assert.equal(disconnected, 1);
});

const countModels = ["user", "organisation", "organisationMember", "plan", "subscription", "auditLog", "session", "privatePreviewAccess",
  "billingContract", "billingInvoice", "location", "station", "channel", "player", "stationStreamConfig", "rewardProgram", "rewardEntitlementGrant",
  "rewardStaffGrant", "rewardAuditEvent", "rewardPilotAuditEvent", "rewardOffer", "rewardShopper", "rewardShopperSetup",
  "rewardShopperCredential", "rewardShopperInvitation", "rewardShopperSession", "rewardShopperMembership",
  "rewardPilotShopperEnrollment", "rewardClaim", "rewardRedemption"];
const counts = async db => Object.fromEntries(await Promise.all(countModels.map(async model => [model, await db[model].count()])));
async function assertDelta(db, before, expected) {
  const after = await counts(db);
  for (const model of countModels) assert.equal(after[model] - before[model], expected[model] || 0, `Unexpected ${model} write.`);
}
const sessionInclude = { user: { include: { privatePreviewAccess: true } }, activeOrganisation: { include: { enterpriseSecurityPolicy: true } } };
async function fixture(db) {
  const suffix = randomUUID().replaceAll("-", ""), prefix = `dormant-${suffix}`;
  const organisation = await db.organisation.create({ data: { name: "Synthetic dormant shopper shop", slug: `${prefix}-shop` } });
  const otherOrganisation = await db.organisation.create({ data: { name: "Unrelated synthetic shop", slug: `${prefix}-other` } });
  const user = await db.user.create({ data: { name: "Synthetic admin", email: `${prefix}-admin@example.invalid`, passwordHash: HASH, role: "SUPER_ADMIN" } });
  const session = await db.session.create({ data: { userId: user.id, tokenHash: randomBytes(32).toString("hex"), authMethod: "PASSWORD",
    createdAt: new Date(+NOW - 60_000), lastSeenAt: new Date(+NOW - 10_000), expiresAt: new Date(+NOW + 3_600_000) } });
  const f = { prefix, organisation, otherOrganisation, user, session, additionalOrganisationIds: [], additionalUserIds: [], planIds: [] };
  f.email = suffix => `${prefix}-${suffix}@example.invalid`;
  f.input = (suffix, patch = {}) => ({ organisationId: organisation.id, email: f.email(suffix), displayName: "Synthetic dormant shopper", confirmCreate: true, ...patch });
  f.loadSession = () => db.session.findUnique({ where: { id: session.id }, include: sessionInclude });
  return f;
}
async function cleanup(db, f) {
  const organisationIds = [f.organisation.id, f.otherOrganisation.id, ...f.additionalOrganisationIds];
  const setups = await db.rewardShopperSetup.findMany({ where: { organisationId: { in: organisationIds }, createdByUserId: f.user.id }, select: { shopperId: true } });
  const shopperIds = setups.map(s => s.shopperId);
  await db.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where: { actorUserId: f.user.id, organisationId: { in: organisationIds } } });
    await tx.rewardShopperSetup.deleteMany({ where: { shopperId: { in: shopperIds } } });
    await tx.rewardShopper.deleteMany({ where: { id: { in: shopperIds } } });
    await tx.subscription.deleteMany({ where: { organisationId: { in: f.additionalOrganisationIds } } });
    await tx.organisationMember.deleteMany({ where: { organisationId: { in: f.additionalOrganisationIds } } });
    await tx.organisation.deleteMany({ where: { id: { in: organisationIds } } });
    await tx.privatePreviewAccess.deleteMany({ where: { userId: f.user.id } });
    await tx.session.deleteMany({ where: { userId: f.user.id } });
    await tx.user.deleteMany({ where: { id: { in: [f.user.id, ...f.additionalUserIds] } } });
    await tx.plan.deleteMany({ where: { id: { in: f.planIds } } });
  });
}
async function withFixture(db, operation) {
  const f = await fixture(db);
  try { await operation(f); } finally { await cleanup(db, f); }
}
async function service(db, f, overrides = {}) {
  const { createDormantShopperService } = await import("../lib/dormant-shopper-provisioning.mjs");
  return createDormantShopperService({ db, loadSession: f.loadSession, env: ENV, clock: () => NOW, ...overrides });
}
function interceptTransaction(db, transform, before) {
  return new Proxy(db, { get(target, key) {
    if (key === "$transaction") return async (work, options) => {
      if (before) await before();
      return target.$transaction(tx => work(transform(tx)), options);
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function rejectsSql(tx, sql, values, accepted = ["23514"]) {
  await tx.$executeRawUnsafe("SAVEPOINT rejected_dormant_setup");
  let error;
  try { await tx.$executeRawUnsafe(sql, ...values); } catch (caught) { error = caught; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rejected_dormant_setup");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT rejected_dormant_setup");
  assert.ok(error, "The forbidden fixture mutation was accepted.");
  assert.ok(accepted.includes(error.meta?.code), `Unexpected SQL rejection ${error.meta?.code}`);
}

test("PostgreSQL 16 dormant shopper preparation remains inert, scoped and atomic", {
  skip: !requested && "Requires the owned disposable shopper-setup cluster or dedicated Rewards CI database."
}, async t => {
  const { db } = await openDormantShopperDatabase(process.env);
  const starting = await counts(db);
  try {
    const { SELF_SERVICE_REGISTRATION_ENABLED } = await import("../lib/registration-availability.mjs");
    assert.equal(SELF_SERVICE_REGISTRATION_ENABLED, false);
    await t.test("master-off preparation writes exactly a disabled shopper, provenance and scrubbed audit", () => withFixture(db, async f => {
      const before = await counts(db), result = await (await service(db, f)).create(f.input("prepared"));
      assert.equal(result.ok, true, result.code);
      assert.deepEqual(result.organisation, { id: f.organisation.id, name: f.organisation.name });
      assert.equal(result.shopper.email, f.email("prepared")); assert.equal(result.shopper.status, "DISABLED");
      await assertDelta(db, before, { rewardShopper: 1, rewardShopperSetup: 1, auditLog: 1 });
      const shopper = await db.rewardShopper.findUnique({ where: { id: result.shopper.id }, include: {
        credential: true, invitation: true, membership: true, sessions: true, pilotEnrollment: true
      } });
      assert.equal(shopper.status, "DISABLED"); assert.equal(shopper.authVersion, 1);
      for (const key of ["credential", "invitation", "membership", "pilotEnrollment"]) assert.equal(shopper[key], null);
      assert.deepEqual(shopper.sessions, []);
      const setup = await db.rewardShopperSetup.findUnique({ where: { shopperId: shopper.id } });
      assert.equal(setup.organisationId, f.organisation.id); assert.equal(setup.createdByUserId, f.user.id);
      assert.equal(setup.emailCanonical, f.email("prepared")); assert.equal(setup.createdAt.toISOString(), NOW.toISOString());
      assert.equal(await db.rewardShopperSetup.count({ where: { organisationId: f.otherOrganisation.id } }), 0);
      const audits = await db.auditLog.findMany({ where: { organisationId: f.organisation.id, entityId: shopper.id } });
      assert.equal(audits.length, 1); assert.equal(audits[0].action, "DORMANT_SHOPPER_PREPARED");
      assert.equal(audits[0].actorUserId, f.user.id);
      assert.deepEqual(audits[0].details, { shopperId: shopper.id, status: "DISABLED", accessGranted: false });
      assert.ok(!JSON.stringify(audits).includes(f.email("prepared")));
      const { createShopperAuthService } = await import("../lib/retail-rewards/shopper-auth-service.mjs");
      const login = { email: result.shopper.email, password: "Only a synthetic testing password" };
      assert.equal((await createShopperAuthService({ db, env: ENV, clock: () => NOW }).login(login)).code, "FEATURE_DISABLED");
      const authEnv = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
        RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "true", SESSION_SECRET: "synthetic-dormant-shopper-auth-secret-only" };
      assert.equal((await createShopperAuthService({ db, env: authEnv, clock: () => NOW }).login(login)).code, "AUTH_FAILED");
      await assertDelta(db, before, { rewardShopper: 1, rewardShopperSetup: 1, auditLog: 1 });
    }));

    await t.test("established preview Super Admin can prepare while master Rewards stays off", () => withFixture(db, async f => {
      await db.privatePreviewAccess.create({ data: { userId: f.user.id, enabled: true, passwordEnabled: true, organisationId: null, expiresAt: null, pillars: [] } });
      await db.session.update({ where: { id: f.session.id }, data: { authMethod: "PREVIEW_PASSWORD" } });
      const env = { ...ENV, NODE_ENV: "production", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
        RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: f.user.email, RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: f.user.email,
        RUVANAS_PUBLIC_URL: "https://preview.example.invalid", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/" };
      const before = await counts(db), result = await (await service(db, f, { env })).create(f.input("preview"));
      assert.equal(result.ok, true, result.code);
      await assertDelta(db, before, { rewardShopper: 1, rewardShopperSetup: 1, auditLog: 1 });
    }));

    await t.test("workspace owners cannot provision or inspect shopper identity collisions", () => withFixture(db, async f => {
      await db.user.update({ where: { id: f.user.id }, data: { role: "OWNER" } });
      const before = await counts(db), result = await (await service(db, f)).create(f.input("forbidden"));
      assert.equal(result.code, "FORBIDDEN"); await assertDelta(db, before, {});
    }));

    await t.test("missing workspace and existing business email create no records", () => withFixture(db, async f => {
      const before = await counts(db), api = await service(db, f);
      assert.equal((await api.create(f.input("missing", { organisationId: "missing-dormant-fixture" }))).code, "ORGANISATION_UNAVAILABLE");
      assert.equal((await api.create(f.input("collision", { email: f.user.email.toUpperCase() }))).code, "EMAIL_EXISTS");
      await assertDelta(db, before, {});
    }));

    await t.test("audit failure rolls back shopper and setup together without leaking errors", () => withFixture(db, async f => {
      const wrapped = interceptTransaction(db, tx => new Proxy(tx, { get(target, key) {
        if (key === "auditLog") return { create: async () => { throw new Error("synthetic-private-error-must-not-be-returned"); } };
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } }));
      const before = await counts(db), result = await (await service(wrapped, f)).create(f.input("rollback"));
      assert.equal(result.code, "UNAVAILABLE");
      assert.ok(!JSON.stringify(result).includes("synthetic-private-error")); await assertDelta(db, before, {});
    }));

    await t.test("session revocation committed after preflight prevents all transaction writes", () => withFixture(db, async f => {
      const wrapped = interceptTransaction(db, tx => tx, () => db.session.update({ where: { id: f.session.id }, data: { revokedAt: NOW } }));
      const before = await counts(db), result = await (await service(wrapped, f)).create(f.input("revoked"));
      assert.equal(result.code, "AUTH_REQUIRED"); await assertDelta(db, before, {});
    }));

    await t.test("concurrent duplicate email requests across workspaces produce one untouched owner binding", () => withFixture(db, async f => {
      const before = await counts(db), api = await service(db, f);
      const outcomes = await Promise.all([
        api.create(f.input("race")),
        api.create(f.input("race", { organisationId: f.otherOrganisation.id, email: f.email("race").toUpperCase() }))
      ]);
      assert.equal(outcomes.filter(r => r.ok).length, 1);
      assert.ok(["EMAIL_EXISTS", "CONFLICT"].includes(outcomes.find(r => !r.ok).code));
      await assertDelta(db, before, { rewardShopper: 1, rewardShopperSetup: 1, auditLog: 1 });
      const winner = outcomes.find(r => r.ok), setup = await db.rewardShopperSetup.findUnique({ where: { shopperId: winner.shopper.id } });
      assert.equal(setup.organisationId, winner.organisation.id);
      assert.equal((await api.create(f.input("race", { organisationId: f.otherOrganisation.id }))).code, "EMAIL_EXISTS");
      assert.equal((await db.rewardShopperSetup.findUnique({ where: { shopperId: setup.shopperId } })).organisationId, setup.organisationId);
    }));

    await t.test("ordinary-owner creation racing shopper preparation cannot reuse the same email", () => withFixture(db, async f => {
      const plan = await db.plan.create({ data: { name: "Synthetic Retail plan", code: `${f.prefix}-PLAN`, productFamily: "RETAIL",
        publiclyAvailable: true, tierNumber: 1, active: true, retailRadioEnabled: true, monthlyPriceCents: 0,
        stationLimit: 1, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128 } });
      f.planIds.push(plan.id);
      const { createOrdinaryOwnerService } = await import("../lib/ordinary-owner-provisioning.mjs");
      const owner = createOrdinaryOwnerService({ db, loadSession: f.loadSession, env: ENV, clock: () => NOW, hashPassword: async () => HASH });
      const shopper = await service(db, f), email = f.email("owner-race");
      const outcomes = await Promise.all([
        shopper.create(f.input("owner-race")),
        owner.create({ name: "Synthetic race workspace", slug: `${f.prefix}-owner-race`, planId: plan.id,
          ownerName: "Synthetic race owner", ownerEmail: email.toUpperCase(), password: "Synthetic test password only", confirmCreate: true })
      ]);
      const ownerResult = outcomes[1];
      if (ownerResult.ok) { f.additionalOrganisationIds.push(ownerResult.organisation.id); f.additionalUserIds.push(ownerResult.owner.id); }
      assert.equal(outcomes.filter(r => r.ok).length, 1);
      assert.ok(["EMAIL_EXISTS", "CONFLICT"].includes(outcomes.find(r => !r.ok).code));
      assert.equal(await db.user.count({ where: { email: { equals: email, mode: "insensitive" } } }) +
        await db.rewardShopperSetup.count({ where: { emailCanonical: email } }), 1);
    }));

    await t.test("SQL rejects noncanonical emails, nonfinite dates and unknown provenance references", () => withFixture(db, async f => {
      const rollback = new Error("ROLL_BACK_ONLY_SYNTHETIC_SETUP_VALIDATION");
      try {
        await db.$transaction(async tx => {
          const shopper = await tx.rewardShopper.create({ data: { displayName: "Synthetic SQL check", status: "DISABLED" } });
          const sql = 'INSERT INTO "RewardShopperSetup" ("shopperId","emailCanonical","organisationId","createdByUserId","createdAt") VALUES ($1,$2,$3,$4,$5::timestamptz)';
          const values = [shopper.id, f.email("sql-check"), f.organisation.id, f.user.id, NOW.toISOString()];
          for (const email of [f.email("UPPER").toUpperCase(), " space@example.invalid", "not-an-email", "two..dots@example.invalid", "unicode-ž@example.invalid"]) {
            const invalid = [...values]; invalid[1] = email;
            await rejectsSql(tx, sql, invalid);
          }
          for (const value of ["infinity", "-infinity"]) {
            const invalid = [...values]; invalid[4] = value;
            await rejectsSql(tx, sql, invalid);
          }
          for (const index of [0, 2]) {
            const invalid = [...values]; invalid[index] = "unknown-synthetic-identity";
            await rejectsSql(tx, sql, invalid, ["23503"]);
          }
          const invalidCreator = [...values]; invalidCreator[3] = "";
          await rejectsSql(tx, sql, invalidCreator);
          throw rollback;
        });
        assert.fail("The synthetic SQL fixture must be rolled back.");
      } catch (error) { if (error !== rollback) throw error; }
    }));

    await t.test("stored setup identity cannot be rebound and foreign keys protect shopper and workspace", () => withFixture(db, async f => {
      const result = await (await service(db, f)).create(f.input("constraints")); assert.equal(result.ok, true, result.code);
      await db.$transaction(async tx => {
        await rejectsSql(tx, 'UPDATE "RewardShopperSetup" SET "organisationId"=$1 WHERE "shopperId"=$2', [f.otherOrganisation.id, result.shopper.id], ["23514", "23000", "55000"]);
        await rejectsSql(tx, 'UPDATE "RewardShopperSetup" SET "emailCanonical"=$1 WHERE "shopperId"=$2', [f.email("replacement"), result.shopper.id], ["23514", "23000", "55000"]);
        await rejectsSql(tx, 'DELETE FROM "RewardShopper" WHERE id=$1', [result.shopper.id], ["23503", "23001"]);
        await rejectsSql(tx, 'DELETE FROM "Organisation" WHERE id=$1', [f.organisation.id], ["23503", "23001"]);
      });
    }));
  } finally {
    try { assert.deepEqual(await counts(db), starting, "Only exact synthetic fixtures may be created, and they must all be cleaned."); }
    finally { await db.$disconnect(); }
  }
});
