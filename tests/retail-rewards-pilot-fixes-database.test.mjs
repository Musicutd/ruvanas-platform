import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_PILOT_FIXES_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const NOW = new Date("2026-11-18T12:00:00.000Z"), END = new Date("2026-11-25T12:00:00.000Z");
const HASH = `$2b$12$${"a".repeat(53)}`;
const SECRET = "synthetic-private-pilot-fixture-secret-only";
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function pilotFixesDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_PILOT_FIXES_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined);
    assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
      GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/); assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.equal(env.DATABASE_URL, CI_URL); assert.equal(env.RUVANAS_REWARDS_DATABASE_URL, CI_URL);
    return { mode: "CI", url: new URL(CI_URL) };
  }
  assert.equal(env.RUVANAS_REWARDS_PILOT_FIXES_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "local_fixture"); assert.equal(url.password, ""); assert.equal(url.hash, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.equal(url.pathname, "/rewards_pilot_fixes_fixture");
  assert.equal(url.search, "?schema=public&connection_limit=6&pool_timeout=10"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR); assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-pilot-fixes-20261118\/pg-[0-9]+-[a-f0-9]{6}\/cluster$/);
  return { mode: "LOCAL", url, cluster };
}
export async function openPilotFixesDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = pilotFixesDatabaseTarget(env, options), db = await createClient(target.url.href);
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

test("pilot-fixes database guard rejects foreign targets before opening a client", async () => {
  assert.equal(pilotFixesDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_PILOT_FIXES_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/foreign" },
    { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_RUN_ID: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openPilotFixesDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openPilotFixesDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) }));
  assert.equal(disconnected, 1);
});

const untouchedModels = ["station", "channel", "channelAssignment", "player", "digitalSignageDevice", "stationStreamConfig",
  "autoDjPolicy", "musicSchedule", "playoutIntent", "billingContract", "billingInvoice"];
const counts = async (db, models = untouchedModels) => Object.fromEntries(await Promise.all(models.map(async model => [model, await db[model].count()])));
const accessModels = ["rewardShopperCredential", "rewardShopperInvitation", "rewardShopperMembership", "rewardShopperSession", "rewardPilotShopperEnrollment"];
const accessCounts = async (db, shopperId) => Object.fromEntries(await Promise.all(accessModels.map(async model => [model, await db[model].count({ where: { shopperId } })])));
const sessionInclude = { user: { include: { privatePreviewAccess: true } }, activeOrganisation: { include: { enterpriseSecurityPolicy: true } } };

async function fixture(db, { siteLimit = 2, rewardLocations = 2 } = {}) {
  const suffix = randomUUID().replaceAll("-", ""), prefix = `pilotfix-${suffix}`;
  const organisation = await db.organisation.create({ data: { name: "Synthetic pilot shop", slug: prefix } });
  const otherOrganisation = await db.organisation.create({ data: { name: "Unrelated synthetic shop", slug: `${prefix}-other` } });
  const user = await db.user.create({ data: { name: "Synthetic Super Admin", email: `${prefix}-admin@example.invalid`, passwordHash: HASH, role: "SUPER_ADMIN" } });
  const session = await db.session.create({ data: { userId: user.id, tokenHash: randomBytes(32).toString("hex"), authMethod: "PASSWORD",
    createdAt: new Date(+NOW - 60000), lastSeenAt: new Date(+NOW - 10000), expiresAt: new Date(+NOW + 3600000) } });
  const plan = await db.plan.create({ data: { name: `Synthetic plan ${prefix}`, code: prefix.toUpperCase(), productFamily: "RETAIL",
    active: true, monthlyPriceCents: 0, stationLimit: siteLimit, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128, retailRadioEnabled: true } });
  const subscription = await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "TRIAL", currentPeriodEnd: END } });
  const program = await db.rewardProgram.create({ data: { organisationId: organisation.id, status: "ACTIVE", networkOptIn: true, timezone: "Europe/Malta" } });
  const grant = await db.rewardEntitlementGrant.create({ data: { organisationId: organisation.id, subscriptionId: subscription.id,
    tier: "REWARDS_STARTER", status: "TRIAL", startsAt: new Date(+NOW - 3600000), expiresAt: END,
    activeOffers: 3, locations: rewardLocations, staffSeats: 2, monthlyRedemptions: 10, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false } });
  const location = await db.location.create({ data: { organisationId: organisation.id, name: "Synthetic draft shop", slug: prefix,
    timezone: "Europe/Malta", countryCode: "MT", status: "DRAFT" } });
  const zone = await db.zone.create({ data: { locationId: location.id, name: "Main Store", slug: "main-store", status: "ACTIVE" } });
  const env = { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0", RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "true",
    RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "true",
    RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: JSON.stringify([organisation.id]), SESSION_SECRET: SECRET };
  const loadSession = client => client.session.findUnique({ where: { id: session.id }, include: sessionInclude });
  const loadContext = async client => { const stored = await loadSession(client); return { session: stored, user: stored?.user }; };
  return { prefix, organisation, otherOrganisation, user, session, plan, subscription, program, grant, location, zone, env, loadSession, loadContext };
}
async function preparedShopper(db, f, label = "shopper") {
  const { createDormantShopperService } = await import("../lib/dormant-shopper-provisioning.mjs");
  const email = `${f.prefix}-${label}@example.invalid`;
  const result = await createDormantShopperService({ db, loadSession: () => f.loadSession(db), clock: () => NOW,
    env: { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0", RUVANAS_RETAIL_REWARDS_ENABLED: "false" } }).create({ organisationId: f.organisation.id, email,
    displayName: "Synthetic shopper", confirmCreate: true });
  assert.equal(result.ok, true, result.code);
  const setup = await db.rewardShopperSetup.findUnique({ where: { shopperId: result.shopper.id } });
  const input = { organisationId: f.organisation.id, shopperId: result.shopper.id, email, authVersion: 1,
    preparedAt: setup.createdAt.toISOString(), expiresAt: END.toISOString(), confirm: true };
  return { id: result.shopper.id, email, setup, input };
}
async function service(db, f, overrides = {}) {
  const { createRewardPilotAdminService } = await import("../lib/retail-rewards/pilot-admin-service.mjs");
  return createRewardPilotAdminService({ db, env: f.env, loadContext: f.loadContext, clock: () => NOW, ...overrides });
}
const locationInput = f => ({ organisationId: f.organisation.id, locationId: f.location.id, confirm: true });
async function noInvitation(db, s) {
  assert.equal((await db.rewardShopper.findUnique({ where: { id: s.id } })).status, "DISABLED");
  assert.deepEqual(await accessCounts(db, s.id), Object.fromEntries(accessModels.map(name => [name, 0])));
}
async function duringDeliveryInsert(db, f, api, newZone) {
  let release, acquired;
  const held = new Promise(resolve => { acquired = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const writer = db.$transaction(async tx => {
    const zone = newZone ? await tx.zone.create({ data: { locationId: f.location.id, name: "Concurrent zone", slug: "concurrent-zone" } }) : f.zone;
    await tx.player.create({ data: { organisationId: f.organisation.id, zoneId: zone.id, name: "Concurrent synthetic player" } });
    acquired(); await gate;
  }, { isolationLevel: "ReadCommitted", timeout: 30000 });
  let operation, result;
  try {
    await Promise.race([held, writer.then(() => { throw new Error("Delivery writer ended before acquisition."); })]);
    operation = api.activateLocation(locationInput(f));
    const deadline = Date.now() + 10000; let waiting = false;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock'
          AND (query LIKE '%"Organisation"%' OR query LIKE '%"Location"%' OR query LIKE '%"Zone"%') AND query LIKE '%FOR UPDATE%'`;
      if (rows[0].count > 0) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, "Activation never reached the held delivery FK lock.");
  } finally {
    release(); await writer; if (operation) result = await operation;
  }
  return result;
}
// Successful immutable audit/enrollment rows deliberately remain in this owned
// disposable database. Do not disable triggers or delete history as cleanup.
test("PostgreSQL 16 exact prepared-shopper invitation and Rewards-only location activation", {
  skip: !requested && "Requires the owned pilot-fixes PostgreSQL 16 cluster or dedicated Rewards CI database."
}, async t => {
  const { db } = await openPilotFixesDatabase(process.env);
  try {
    const { SELF_SERVICE_REGISTRATION_ENABLED } = await import("../lib/registration-availability.mjs");
    assert.equal(SELF_SERVICE_REGISTRATION_ENABLED, false);
    await t.test("flags off cause no service load, identity read or database write", async () => {
      const { createRewardPilotAdminService } = await import("../lib/retail-rewards/pilot-admin-service.mjs");
      let accessed = 0; const closed = createRewardPilotAdminService({ db: new Proxy({}, { get() { accessed++; throw new Error("must not touch DB"); } }),
        env: { RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, loadContext: () => { accessed++; } });
      assert.equal((await closed.invitePrepared({})).code, "FEATURE_DISABLED");
      assert.equal((await closed.activateLocation({})).code, "FEATURE_DISABLED"); assert.equal(accessed, 0);
    });
    await t.test("exact prepared shopper is invited once, remains disabled, then accepts using existing auth", async () => {
      const f = await fixture(db), s = await preparedShopper(db, f), api = await service(db, f), untouched = await counts(db);
      const baseline = { users: await db.user.count(), members: await db.organisationMember.count(), shoppers: await db.rewardShopper.count() };
      assert.equal((await api.invite({ organisationId: f.organisation.id, email: s.email, displayName: "Duplicate", expiresAt: END.toISOString(), confirm: true })).code, "CONFLICT");
      const result = await api.invitePrepared(s.input); assert.equal(result.ok, true, result.code); assert.equal(result.shopperId, s.id);
      assert.match(result.invitationToken, /^[a-f0-9]{64}$/);
      assert.equal(result.invitationExpiresAt, new Date(+NOW + 86400000).toISOString());
      assert.equal((await db.rewardShopper.findUnique({ where: { id: s.id } })).status, "DISABLED");
      assert.deepEqual(await db.rewardShopperSetup.findUnique({ where: { shopperId: s.id } }), s.setup);
      assert.deepEqual(await accessCounts(db, s.id), { rewardShopperCredential: 0, rewardShopperInvitation: 1, rewardShopperMembership: 1, rewardShopperSession: 0, rewardPilotShopperEnrollment: 1 });
      const invitation = await db.rewardShopperInvitation.findUnique({ where: { shopperId: s.id } });
      const audit = await db.rewardPilotAuditEvent.findMany({ where: { organisationId: f.organisation.id, targetId: s.id } });
      assert.equal(audit.length, 1); assert.equal(audit[0].action, "SHOPPER_INVITED");
      assert.ok(!JSON.stringify([invitation, audit]).includes(result.invitationToken), "Raw invite code must not be persisted.");
      assert.equal((await api.invitePrepared(s.input)).ok, false);
      const { createShopperAuthService } = await import("../lib/retail-rewards/shopper-auth-service.mjs");
      const acceptance = { token: result.invitationToken, password: "Only a synthetic local passphrase!" };
      assert.equal((await createShopperAuthService({ db, env: { ...f.env, RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, clock: () => NOW }).acceptInvite(acceptance)).code, "FEATURE_DISABLED");
      const accepted = await createShopperAuthService({ db, env: f.env, clock: () => NOW }).acceptInvite(acceptance);
      assert.equal(accepted.ok, true, accepted.code); assert.equal((await db.rewardShopper.findUnique({ where: { id: s.id } })).status, "ACTIVE");
      assert.equal((await createShopperAuthService({ db, env: f.env, clock: () => NOW }).acceptInvite(acceptance)).code, "INVITATION_UNAVAILABLE");
      assert.deepEqual({ users: await db.user.count(), members: await db.organisationMember.count(), shoppers: await db.rewardShopper.count() }, baseline);
      assert.deepEqual(await counts(db), untouched);
    });
    await t.test("concurrent prepared invitations create exactly one membership, invitation and audit", async () => {
      const f = await fixture(db), s = await preparedShopper(db, f), api = await service(db, f);
      const results = await Promise.all([api.invitePrepared(s.input), api.invitePrepared(s.input)]);
      assert.equal(results.filter(row => row.ok).length, 1); assert.equal(results.filter(row => !row.ok).length, 1);
      assert.deepEqual(await accessCounts(db, s.id), { rewardShopperCredential: 0, rewardShopperInvitation: 1, rewardShopperMembership: 1, rewardShopperSession: 0, rewardPilotShopperEnrollment: 1 });
      assert.equal(await db.rewardPilotAuditEvent.count({ where: { organisationId: f.organisation.id, targetId: s.id, action: "SHOPPER_INVITED" } }), 1);
      assert.equal((await db.rewardShopper.findUnique({ where: { id: s.id } })).status, "DISABLED");
    });
    await t.test("prepared invitation supports existing reissue and revocation without activating the shopper", async () => {
      const f = await fixture(db), s = await preparedShopper(db, f), api = await service(db, f);
      const initial = await api.invitePrepared(s.input); assert.equal(initial.ok, true, initial.code);
      const reissued = await api.reissue({ organisationId: f.organisation.id, shopperId: s.id, confirm: true });
      assert.equal(reissued.ok, true, reissued.code); assert.notEqual(reissued.invitationToken, initial.invitationToken);
      const { createShopperAuthService } = await import("../lib/retail-rewards/shopper-auth-service.mjs");
      const auth = createShopperAuthService({ db, env: f.env, clock: () => NOW });
      assert.equal((await auth.acceptInvite({ token: initial.invitationToken, password: "Only a synthetic local passphrase!" })).code, "INVITATION_UNAVAILABLE");
      assert.equal((await api.revoke({ organisationId: f.organisation.id, shopperId: s.id, confirm: true })).ok, true);
      assert.equal((await auth.acceptInvite({ token: reissued.invitationToken, password: "Only a synthetic local passphrase!" })).code, "INVITATION_UNAVAILABLE");
      assert.equal((await db.rewardShopper.findUnique({ where: { id: s.id } })).status, "DISABLED");
      assert.equal(await db.rewardShopperCredential.count({ where: { shopperId: s.id } }), 0);
      assert.equal(await db.rewardShopperSession.count({ where: { shopperId: s.id } }), 0);
      assert.deepEqual(await db.rewardShopperSetup.findUnique({ where: { shopperId: s.id } }), s.setup);
    });
    await t.test("foreign scope, stale provenance and case-insensitive account collisions cannot adopt shopper", async () => {
      const f = await fixture(db), s = await preparedShopper(db, f), api = await service(db, f);
      for (const patch of [{ organisationId: f.otherOrganisation.id }, { authVersion: 2 }, { preparedAt: new Date(+NOW - 1).toISOString() }, { email: `${f.prefix}-wrong@example.invalid` }]) {
        assert.equal((await api.invitePrepared({ ...s.input, ...patch })).ok, false); await noInvitation(db, s);
      }
      await db.user.create({ data: { email: s.email.toUpperCase(), name: "Synthetic collision", passwordHash: HASH, role: "OWNER" } });
      assert.equal((await api.invitePrepared(s.input)).ok, false); await noInvitation(db, s);
      assert.deepEqual(await db.rewardShopperSetup.findUnique({ where: { shopperId: s.id } }), s.setup);
    });
    await t.test("missing preparation audit and unexpected existing access are rejected", async () => {
      const f = await fixture(db), s = await preparedShopper(db, f), api = await service(db, f);
      await db.auditLog.deleteMany({ where: { organisationId: f.organisation.id, entityId: s.id, action: "DORMANT_SHOPPER_PREPARED" } });
      assert.equal((await api.invitePrepared(s.input)).ok, false); await noInvitation(db, s);
      const other = await preparedShopper(db, f, "unexpected-membership");
      await db.rewardShopperMembership.create({ data: { shopperId: other.id, status: "DISABLED", startsAt: NOW, expiresAt: END } });
      const before = await accessCounts(db, other.id);
      assert.equal((await api.invitePrepared(other.input)).ok, false); assert.deepEqual(await accessCounts(db, other.id), before);
    });
    await t.test("expired window, auth-off policy and revoked admin produce no invitation", async () => {
      const f = await fixture(db), s = await preparedShopper(db, f), api = await service(db, f);
      for (const expiresAt of [NOW.toISOString(), new Date(+END + 1).toISOString()]) assert.equal((await api.invitePrepared({ ...s.input, expiresAt })).ok, false);
      assert.equal((await (await service(db, f, { env: { ...f.env, RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "false" } })).invitePrepared(s.input)).ok, false);
      await db.session.update({ where: { id: f.session.id }, data: { revokedAt: NOW } });
      assert.equal((await api.invitePrepared(s.input)).ok, false); await noInvitation(db, s);
    });
    await t.test("final authority failure rolls back invitation and enrollment atomically", async () => {
      const f = await fixture(db), s = await preparedShopper(db, f); let reads = 0;
      const api = await service(db, f, { loadContext: async client => {
        const context = await f.loadContext(client); reads++;
        return reads >= 3 ? { ...context, user: { ...context.user, role: "OWNER" } } : context;
      } });
      assert.equal((await api.invitePrepared(s.input)).ok, false); await noInvitation(db, s);
      assert.equal(await db.rewardPilotAuditEvent.count({ where: { organisationId: f.organisation.id, targetId: s.id } }), 0);
    });
    await t.test("draft shop activates and publishes without audio, preserves metadata and retries idempotently", async () => {
      const f = await fixture(db, { siteLimit: 1, rewardLocations: 1 }), api = await service(db, f), untouched = await counts(db);
      const zones = await db.zone.findMany({ where: { locationId: f.location.id } });
      const result = await api.activateLocation(locationInput(f)); assert.equal(result.ok, true, result.code);
      assert.equal(result.locationId, f.location.id); assert.equal(result.status, "ACTIVE");
      const after = await db.location.findUnique({ where: { id: f.location.id } });
      const withoutMutable = row => { const { status, updatedAt, ...rest } = row; return rest; };
      assert.deepEqual(withoutMutable(after), withoutMutable(f.location));
      assert.deepEqual(await db.zone.findMany({ where: { locationId: f.location.id } }), zones);
      assert.deepEqual(await counts(db), untouched);
      const auditWhere = { organisationId: f.organisation.id, entityId: f.location.id, action: "REWARDS_PILOT_LOCATION_ACTIVATED" };
      assert.equal(await db.auditLog.count({ where: auditWhere }), 1);
      assert.equal((await api.activateLocation(locationInput(f))).ok, true);
      assert.equal(await db.auditLog.count({ where: auditWhere }), 1);
      const published = await api.publishShop({ ...locationInput(f), publicSlug: `shop-${f.prefix.slice(-16)}`, displayName: "Synthetic test shop", description: "Simulated purchases only", locality: "Test location", countryCode: "MT" });
      assert.equal(published.ok, true, published.code); assert.equal(await db.rewardPublicShopProfile.count({ where: { organisationId: f.organisation.id, locationId: f.location.id, status: "PUBLISHED" } }), 1);
      assert.deepEqual(await counts(db), untouched);
    });
    await t.test("cross-tenant and audio-capable locations are refused without changing them", async () => {
      const f = await fixture(db), api = await service(db, f);
      const foreign = await db.location.create({ data: { organisationId: f.otherOrganisation.id, name: "Foreign", slug: `${f.prefix}-foreign` } });
      assert.equal((await api.activateLocation({ ...locationInput(f), locationId: foreign.id })).ok, false);
      const player = await db.player.create({ data: { organisationId: f.organisation.id, zoneId: f.zone.id, name: "Synthetic existing player" } });
      const before = await counts(db);
      assert.equal((await api.activateLocation(locationInput(f))).ok, false);
      assert.equal((await db.location.findUnique({ where: { id: f.location.id } })).status, "DRAFT");
      assert.deepEqual(await db.player.findUnique({ where: { id: player.id } }), player); assert.deepEqual(await counts(db), before);
    });
    await t.test("site and Rewards location limits cannot be bypassed by activating a draft", async () => {
      for (const constrained of ["site", "reward"]) {
        const f = await fixture(db, { siteLimit: constrained === "site" ? 1 : 2, rewardLocations: constrained === "reward" ? 1 : 2 }), api = await service(db, f);
        await db.location.create({ data: { organisationId: f.organisation.id, name: "Existing active shop", slug: `${f.prefix}-existing`, status: "ACTIVE" } });
        assert.equal((await api.activateLocation(locationInput(f))).ok, false);
        assert.equal((await db.location.findUnique({ where: { id: f.location.id } })).status, "DRAFT");
      }
    });
    await t.test("concurrent activation of two drafts cannot oversubscribe one Rewards location", async () => {
      const f = await fixture(db, { siteLimit: 2, rewardLocations: 1 }), api = await service(db, f);
      const second = await db.location.create({ data: { organisationId: f.organisation.id, name: "Second draft", slug: `${f.prefix}-second`, status: "DRAFT" } });
      const results = await Promise.all([api.activateLocation(locationInput(f)), api.activateLocation({ ...locationInput(f), locationId: second.id })]);
      assert.equal(results.filter(row => row.ok).length, 1); assert.equal(results.filter(row => !row.ok).length, 1);
      assert.equal(await db.location.count({ where: { organisationId: f.organisation.id, status: "ACTIVE" } }), 1);
      assert.equal(await db.auditLog.count({ where: { organisationId: f.organisation.id, action: "REWARDS_PILOT_LOCATION_ACTIVATED" } }), 1);
    });
    await t.test("final authority rejection rolls back location activation and its audit", async () => {
      const f = await fixture(db); let reads = 0;
      const api = await service(db, f, { loadContext: async client => { const context = await f.loadContext(client); reads++;
        return reads >= 3 ? { ...context, user: { ...context.user, role: "OWNER" } } : context;
      } });
      const untouched = await counts(db);
      assert.equal((await api.activateLocation(locationInput(f))).ok, false);
      assert.equal((await db.location.findUnique({ where: { id: f.location.id } })).status, "DRAFT");
      assert.equal(await db.auditLog.count({ where: { organisationId: f.organisation.id, entityId: f.location.id, action: "REWARDS_PILOT_LOCATION_ACTIVATED" } }), 0);
      assert.deepEqual(await counts(db), untouched);
    });
    await t.test("grant expiry during the final admin check rolls back location activation", async () => {
      const f = await fixture(db), expiresAt = new Date(+NOW + 30000); let reads = 0, instant = NOW;
      await db.rewardEntitlementGrant.update({ where: { id: f.grant.id }, data: { expiresAt } });
      const api = await service(db, f, { clock: () => instant, loadContext: async client => {
        const context = await f.loadContext(client); reads++; if (reads >= 3) instant = expiresAt; return context;
      } });
      const untouched = await counts(db);
      assert.equal((await api.activateLocation(locationInput(f))).ok, false);
      assert.equal((await db.location.findUnique({ where: { id: f.location.id } })).status, "DRAFT");
      assert.equal(await db.auditLog.count({ where: { organisationId: f.organisation.id, entityId: f.location.id, action: "REWARDS_PILOT_LOCATION_ACTIVATED" } }), 0);
      assert.deepEqual(await counts(db), untouched);
    });
    await t.test("concurrent new-zone player insertion cannot hide behind an older activation snapshot", async () => {
      const f = await fixture(db), api = await service(db, f);
      const result = await duringDeliveryInsert(db, f, api, true);
      assert.equal(result.ok, false, "Activation must not admit delivery inserted while it waited for the Location FK lock.");
      assert.equal((await db.location.findUnique({ where: { id: f.location.id } })).status, "DRAFT");
      assert.equal(await db.player.count({ where: { organisationId: f.organisation.id } }), 1);
    });
    await t.test("concurrent existing-zone player insertion is rechecked after the zone lock wait", async () => {
      const f = await fixture(db), api = await service(db, f);
      const result = await duringDeliveryInsert(db, f, api, false);
      assert.equal(result.ok, false, "Activation must not admit delivery inserted while it waited for the Zone FK lock.");
      assert.equal((await db.location.findUnique({ where: { id: f.location.id } })).status, "DRAFT");
      assert.equal(await db.player.count({ where: { organisationId: f.organisation.id } }), 1);
    });
  } finally { await db.$disconnect(); }
});
