import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_PILOT_RENEWAL_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const BEFORE = new Date("2026-11-18T12:00:00.000Z"), EXPIRED = new Date("2026-11-18T13:00:00.000Z");
const NOW = new Date("2026-11-19T12:00:00.000Z"), END = new Date("2026-11-19T13:00:00.000Z");
const HASH = `$2b$12$${"a".repeat(53)}`, SECRET = "synthetic-renewal-fixture-secret-only-never-a-live-secret";
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Fail closed before constructing Prisma. This suite never discovers or uses
// an application database, even when one exists in the surrounding shell.
export function pilotRenewalDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
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
  assert.equal(env.RUVANAS_REWARDS_PILOT_RENEWAL_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "local_fixture"); assert.equal(url.password, ""); assert.equal(url.hash, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.equal(url.pathname, "/rewards_pilot_renewal_fixture");
  assert.equal(url.search, "?schema=public&connection_limit=6&pool_timeout=10"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR); assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-pilot-renewal-20261119\/pg-[0-9]+-[a-f0-9]{6}\/cluster$/);
  return { mode: "LOCAL", url, cluster };
}
export async function openPilotRenewalDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = pilotRenewalDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    assert.ok(identity.version >= 160000 && identity.version < 170000, "This suite requires PostgreSQL 16.");
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "local_fixture"); assert.equal(identity.host, "127.0.0.1"); assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}
const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-pilot-renewal-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });

test("pilot-renewal database guard rejects unrelated targets before constructing a client", async () => {
  assert.equal(pilotRenewalDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_PILOT_RENEWAL_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/foreign" },
    { GITHUB_JOB: "rewards-database" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_RUN_ID: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openPilotRenewalDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  const cluster = path.resolve("output/retail-rewards-pilot-renewal-20261119/pg-123-abcdef/cluster");
  const url = "postgresql://local_fixture@127.0.0.1:55432/rewards_pilot_renewal_fixture?schema=public&connection_limit=6&pool_timeout=10";
  const local = { RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_PILOT_RENEWAL_LOCAL_TEST: "1", DATABASE_URL: url,
    RUVANAS_REWARDS_DATABASE_URL: url, RUVANAS_REWARDS_CLUSTER_DIR: cluster };
  assert.equal(pilotRenewalDatabaseTarget(local, { realpath: v => v }).mode, "LOCAL");
  for (const patch of [{ RUVANAS_REWARDS_PILOT_RENEWAL_LOCAL_TEST: "true" }, { RUVANAS_REWARDS_CLUSTER_DIR: path.resolve("output/unrelated/cluster") },
    ...[url.replace("127.0.0.1", "localhost"), url.replace("local_fixture@", "local_fixture:secret@"), url.replace("55432", "5432").replace("renewal_fixture", "production"),
      `${url}&application_name=anything`, url.replace("connection_limit=6", "connection_limit=9")].map(value => ({ DATABASE_URL: value, RUVANAS_REWARDS_DATABASE_URL: value }))]) {
    let clients = 0;
    await assert.rejects(openPilotRenewalDatabase({ ...local, ...patch }, { realpath: v => v, createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openPilotRenewalDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) }));
  assert.equal(disconnected, 1);
});

const untouchedModels = ["station", "channel", "channelAssignment", "player", "digitalSignageDevice", "stationStreamConfig",
  "autoDjPolicy", "musicSchedule", "playoutIntent", "billingContract", "billingInvoice", "rewardClaim", "rewardRedemption", "rewardRedemptionReversal"];
const counts = async db => Object.fromEntries(await Promise.all(untouchedModels.map(async model => [model, await db[model].count()])));
const sessionInclude = { user: { include: { privatePreviewAccess: true } }, activeOrganisation: { include: { enterpriseSecurityPolicy: true } } };
async function service(db, f, overrides = {}) {
  const { createRewardPilotAdminService } = await import("../lib/retail-rewards/pilot-admin-service.mjs");
  return createRewardPilotAdminService({ db, env: f.env, loadContext: f.loadContext, clock: () => NOW, ...overrides });
}
async function fixture(db) {
  const prefix = `pilotrenew-${randomUUID().replaceAll("-", "")}`;
  const organisation = await db.organisation.create({ data: { name: "Synthetic renewal shop", slug: prefix } });
  const otherOrganisation = await db.organisation.create({ data: { name: "Unrelated synthetic shop", slug: `${prefix}-other` } });
  const user = await db.user.create({ data: { name: "Synthetic Super Admin", email: `${prefix}-admin@example.invalid`, passwordHash: HASH, role: "SUPER_ADMIN" } });
  const session = await db.session.create({ data: { userId: user.id, tokenHash: randomBytes(32).toString("hex"), authMethod: "PASSWORD",
    createdAt: new Date(+BEFORE - 60000), lastSeenAt: BEFORE, expiresAt: new Date(+NOW + 4 * 3600000) } });
  const plan = await db.plan.create({ data: { name: `Synthetic plan ${prefix}`, code: prefix.toUpperCase(), productFamily: "RETAIL",
    active: true, monthlyPriceCents: 0, stationLimit: 1, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128, retailRadioEnabled: true } });
  const subscription = await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "TRIAL", currentPeriodEnd: new Date(+NOW + 86400000) } });
  const program = await db.rewardProgram.create({ data: { organisationId: organisation.id, status: "ACTIVE", networkOptIn: true, timezone: "Europe/Malta" } });
  const grant = await db.rewardEntitlementGrant.create({ data: { organisationId: organisation.id, subscriptionId: subscription.id,
    tier: "REWARDS_STARTER", status: "TRIAL", startsAt: new Date(+BEFORE - 3600000), expiresAt: EXPIRED,
    activeOffers: 3, locations: 1, staffSeats: 1, monthlyRedemptions: 4, analyticsRetentionDays: 7, exportEnabled: false, brandingEnabled: false } });
  const location = await db.location.create({ data: { organisationId: organisation.id, name: "Synthetic active shop", slug: prefix,
    timezone: "Europe/Malta", countryCode: "MT", status: "ACTIVE" } });
  const zone = await db.zone.create({ data: { locationId: location.id, name: "Main Store", slug: "main-store", status: "ACTIVE" } });
  const env = { RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: user.email,
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: user.email, RUVANAS_PUBLIC_URL: "http://127.0.0.1:3999",
    RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/", RUVANAS_ENVIRONMENT: "LOCAL_SYNTHETIC_PRIVATE_PREVIEW",
    RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "true",
    RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
    RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false",
    RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: JSON.stringify([organisation.id]), SESSION_SECRET: SECRET };
  const loadSession = client => client.session.findUnique({ where: { id: session.id }, include: sessionInclude });
  const loadContext = async client => { const stored = await loadSession(client); return { session: stored, user: stored?.user }; };
  const f = { prefix, organisation, otherOrganisation, user, session, plan, subscription, program, grant, location, zone, env, loadSession, loadContext };
  const { createDormantShopperService } = await import("../lib/dormant-shopper-provisioning.mjs");
  const email = `${prefix}-shopper@example.invalid`;
  const prepared = await createDormantShopperService({ db, loadSession: () => loadSession(db), clock: () => BEFORE,
    env: { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0", RUVANAS_RETAIL_REWARDS_ENABLED: "false" } }).create({ organisationId: organisation.id,
    email, displayName: "Synthetic expired shopper", confirmCreate: true });
  assert.equal(prepared.ok, true, prepared.code);
  const shopperId = prepared.shopper.id, setup = await db.rewardShopperSetup.findUnique({ where: { shopperId } });
  const beforeApi = await service(db, f, { clock: () => BEFORE });
  const invited = await beforeApi.invitePrepared({ organisationId: organisation.id, shopperId, email, authVersion: 1,
    preparedAt: setup.createdAt.toISOString(), expiresAt: EXPIRED.toISOString(), confirm: true });
  assert.equal(invited.ok, true, invited.code);
  assert.equal((await beforeApi.revoke({ organisationId: organisation.id, shopperId, confirm: true })).ok, true);
  await db.session.update({ where: { id: session.id }, data: { lastSeenAt: NOW } });
  return { ...f, shopperId, email, setup, oldInvitationToken: invited.invitationToken };
}
const ids = f => ({ organisationId: f.organisation.id, shopperId: f.shopperId });
async function inputFor(api, f, patch = {}) {
  const review = await api.renewalReview(ids(f)); assert.equal(review.ok, true, review.code); assert.match(review.expectedState, /^[a-f0-9]{64}$/);
  return { ...ids(f), expectedState: review.expectedState, expiresAt: END.toISOString(), requestId: randomUUID(), confirm: true, ...patch };
}
async function state(db, f) {
  const shopperId = f.shopperId, organisationId = f.organisation.id;
  const values = await Promise.all([
    db.rewardEntitlementGrant.findUnique({ where: { organisationId } }), db.rewardShopperMembership.findUnique({ where: { shopperId } }),
    db.rewardShopper.findUnique({ where: { id: shopperId } }), db.rewardShopperSetup.findUnique({ where: { shopperId } }),
    db.rewardPilotShopperEnrollment.findUnique({ where: { shopperId } }), db.rewardShopperInvitation.findUnique({ where: { shopperId } }),
    db.rewardShopperCredential.findUnique({ where: { shopperId } }), db.rewardShopperSession.findMany({ where: { shopperId }, orderBy: { id: "asc" } }),
    db.rewardPilotAuditEvent.findMany({ where: { organisationId }, orderBy: { id: "asc" } })
  ]);
  return Object.fromEntries(["grant", "membership", "shopper", "setup", "enrollment", "invitation", "credential", "sessions", "audits"].map((key, i) => [key, values[i]]));
}
const without = (obj, ...keys) => Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));
async function offer(db, f, expiresAt = EXPIRED) {
  const terms = { schemaVersion: 1, title: "Synthetic coupon", description: "Renewal regression only", category: "HOME", type: "PERCENT_OFF",
    percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000,
    exclusions: "None", legalTerms: "Synthetic", combinable: false, startsAt: BEFORE.toISOString(), endsAt: expiresAt.toISOString(),
    timezone: "Europe/Malta", locationIds: [f.location.id], usage: "REUSABLE", totalLimit: 20, perShopperLimit: 2,
    perShopperDailyLimit: 2, pausedClaimsPolicy: "HONOUR_ISSUED" };
  const row = await db.rewardOffer.create({ data: { organisationId: f.organisation.id, programId: f.program.id, draft: terms,
    createdByUserId: f.user.id, updatedByUserId: f.user.id } });
  await db.rewardOfferRevision.create({ data: { organisationId: f.organisation.id, offerId: row.id, revision: 1, terms, actorUserId: f.user.id } });
  return db.rewardOffer.update({ where: { id: row.id }, data: { state: "PUBLISHED", lastRevision: 1, publishedRevision: 1,
    publishedStartsAt: BEFORE, publishedEndsAt: expiresAt } });
}
async function history(db, f, shopperId) {
  const row = await offer(db, f);
  const member = await db.organisationMember.create({ data: { organisationId: f.organisation.id, userId: f.user.id, role: "OWNER" } });
  const shopper = shopperId ? { id: shopperId } : await db.rewardShopper.create({ data: { displayName: "Unrelated historical shopper", status: "DISABLED" } });
  await db.rewardOfferUsagePolicy.create({ data: { organisationId: f.organisation.id, offerId: row.id, timezone: "Europe/Malta" } });
  for (let use = 0; use < 2; use++) {
    const claim = await db.rewardClaim.create({ data: { organisationId: f.organisation.id, offerId: row.id, revision: 1, shopperId: shopper.id,
      shopperAuthVersion: 1, locationId: f.location.id, publicShopName: "Synthetic shop", publicShopSlug: "synthetic-shop",
      createdAt: BEFORE, expiresAt: EXPIRED } });
    await db.rewardRedemption.create({ data: { organisationId: f.organisation.id, offerId: row.id, shopperId: shopper.id,
      locationId: f.location.id, claimId: claim.id, actorUserId: f.user.id, actorOrganisationMemberId: member.id,
      idempotencyKeyHash: randomBytes(32).toString("hex"), requestHash: randomBytes(32).toString("hex"),
      eligibleSpendMinor: 6000, currency: "EUR", discountMinor: 600, occurredAt: new Date(+BEFORE + use * 1000) } });
  }
  return row;
}
const historicalRows = (db, f) => Promise.all([db.rewardClaim.findMany({ where: { organisationId: f.organisation.id }, orderBy: { id: "asc" } }),
  db.rewardRedemption.findMany({ where: { organisationId: f.organisation.id }, orderBy: { id: "asc" } }),
  db.rewardOffer.findMany({ where: { organisationId: f.organisation.id }, orderBy: { id: "asc" } }),
  db.rewardOfferRevision.findMany({ where: { organisationId: f.organisation.id }, orderBy: { id: "asc" } })]);
async function assertDeniedUnchanged(db, f, operation) {
  const before = await state(db, f), result = await operation(); assert.equal(result.ok, false);
  assert.deepEqual(await state(db, f), before); return result;
}
// Concurrent writer commits a revoked authority while the renewal waits on its
// exact row lock. SERIALIZABLE retry must observe the committed revocation.
async function revokeWhileWaiting(db, f, api, input, model) {
  let release, acquired;
  const held = new Promise(resolve => { acquired = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const writer = db.$transaction(async tx => {
    if (model === "grant") await tx.rewardEntitlementGrant.update({ where: { id: f.grant.id }, data: { status: "SUSPENDED" } });
    else await tx.session.update({ where: { id: f.session.id }, data: { revokedAt: NOW } });
    acquired(); await gate;
  }, { isolationLevel: "ReadCommitted", timeout: 30000 });
  let operation, result;
  try {
    await Promise.race([held, writer.then(() => { throw new Error("Writer ended before lock acquisition."); })]);
    operation = api.renew(input);
    const deadline = Date.now() + 8000; let waiting = false;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock'
          AND (query LIKE '%"RewardEntitlementGrant"%' OR query LIKE '%"Session"%') AND query LIKE '%FOR %'`;
      if (rows[0].count > 0) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, "Renewal did not reach its authority row lock.");
  } finally { release(); await writer; if (operation) result = await operation; }
  return result;
}

// History deliberately remains in the owned disposable database. No cleanup
// disables constraints, deletes immutable evidence, or rewrites existing data.
test("PostgreSQL 16 expired private pilot renewal preserves identities and authorization boundaries", {
  skip: !requested && "Requires the owned renewal PostgreSQL 16 cluster or dedicated CI job."
}, async t => {
  const { db } = await openPilotRenewalDatabase(process.env);
  try {
    const { SELF_SERVICE_REGISTRATION_ENABLED } = await import("../lib/registration-availability.mjs");
    assert.equal(SELF_SERVICE_REGISTRATION_ENABLED, false);
    await t.test("disabled flags cause no authority read, database load or write", async () => {
      const { createRewardPilotAdminService } = await import("../lib/retail-rewards/pilot-admin-service.mjs");
      let accessed = 0;
      const closed = createRewardPilotAdminService({ db: new Proxy({}, { get() { accessed++; throw new Error("Unexpected database access"); } }),
        env: { RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, loadContext: () => { accessed++; } });
      assert.equal((await closed.renewalReview({})).code, "FEATURE_DISABLED"); assert.equal((await closed.renew({})).code, "FEATURE_DISABLED");
      assert.equal(accessed, 0);
    });
    await t.test("review is read-only; renewal changes only existing expiries/version and appends one safe audit", async () => {
      const f = await fixture(db), api = await service(db, f);
      await history(db, f); // Existing monthly usage belongs to the same tenant, but not the never-activated target.
      const before = await state(db, f), untouched = await counts(db), past = await historicalRows(db, f);
      assert.equal(past[1].length, 2);
      const infrastructure = await Promise.all([db.plan.findUnique({ where: { id: f.plan.id } }), db.subscription.findUnique({ where: { id: f.subscription.id } }),
        db.rewardProgram.findUnique({ where: { id: f.program.id } }), db.location.findUnique({ where: { id: f.location.id } }), db.zone.findUnique({ where: { id: f.zone.id } })]);
      const input = await inputFor(api, f); assert.deepEqual(await state(db, f), before);
      const result = await api.renew(input); assert.equal(result.ok, true, result.code);
      assert.equal(result.shopperId, f.shopperId); assert.equal(result.programId, f.program.id); assert.equal(result.grantId, before.grant.id);
      assert.equal(result.membershipId, before.membership.id); assert.equal(result.membershipVersion, before.membership.version + 1);
      assert.equal(result.expiresAt, END.toISOString()); assert.equal(result.requestId, input.requestId);
      const after = await state(db, f);
      assert.deepEqual(without(after.grant, "expiresAt", "updatedAt"), without(before.grant, "expiresAt", "updatedAt"));
      assert.deepEqual(without(after.membership, "expiresAt", "version", "updatedAt"), without(before.membership, "expiresAt", "version", "updatedAt"));
      assert.equal(after.grant.expiresAt.toISOString(), END.toISOString()); assert.equal(after.membership.expiresAt.toISOString(), END.toISOString());
      for (const key of ["shopper", "setup", "enrollment", "invitation", "credential", "sessions"]) assert.deepEqual(after[key], before[key], key);
      assert.equal(after.shopper.status, "DISABLED"); assert.equal(after.credential, null); assert.equal(after.sessions.length, 0);
      const added = after.audits.filter(row => !before.audits.some(old => old.id === row.id)); assert.equal(added.length, 1);
      const [audit] = added; assert.equal(audit.action, "PILOT_ACCESS_RENEWED"); assert.equal(audit.targetType, "PROGRAM");
      assert.equal(audit.targetId, f.program.id); assert.equal(audit.actorUserId, f.user.id); assert.equal(audit.requestId, input.requestId);
      assert.equal(audit.metadataJson.status, "RENEWED"); assert.equal(audit.metadataJson.expiresAt, END.toISOString());
      assert.equal(audit.metadataJson.previousGrantExpiry, EXPIRED.toISOString()); assert.equal(audit.metadataJson.previousMembershipExpiry, EXPIRED.toISOString());
      assert.match(audit.metadataJson.requestHash, /^[a-f0-9]{64}$/); assert.match(audit.metadataJson.afterStateHash, /^[a-f0-9]{64}$/);
      assert.equal(audit.metadataJson.membershipVersion, before.membership.version + 1);
      assert.ok(!JSON.stringify([result, audit]).includes(f.oldInvitationToken)); assert.ok(!JSON.stringify(audit).includes(f.email));
      for (const old of before.audits) assert.deepEqual(after.audits.find(row => row.id === old.id), old);
      assert.deepEqual(await counts(db), untouched);
      assert.deepEqual(await historicalRows(db, f), past);
      assert.deepEqual(await Promise.all([db.plan.findUnique({ where: { id: f.plan.id } }), db.subscription.findUnique({ where: { id: f.subscription.id } }),
        db.rewardProgram.findUnique({ where: { id: f.program.id } }), db.location.findUnique({ where: { id: f.location.id } }), db.zone.findUnique({ where: { id: f.zone.id } })]), infrastructure);
    });
    await t.test("same request concurrent retries return one committed renewal; competing keys cannot double-renew", async () => {
      const f = await fixture(db), api = await service(db, f), input = await inputFor(api, f), before = await state(db, f);
      const results = await Promise.all([api.renew(input), api.renew(input)]);
      assert.equal(results[0].ok, true, results[0].code); assert.deepEqual(results[1], results[0]);
      assert.equal((await state(db, f)).membership.version, before.membership.version + 1);
      assert.equal(await db.rewardPilotAuditEvent.count({ where: { organisationId: f.organisation.id, action: "PILOT_ACCESS_RENEWED" } }), 1);
      await assertDeniedUnchanged(db, f, () => api.renew({ ...input, expiresAt: new Date(+END + 1000).toISOString() }));
      await assertDeniedUnchanged(db, f, () => api.renew({ ...input, requestId: randomUUID() }));
      const other = await fixture(db), second = await service(db, other), sameState = await inputFor(second, other);
      const competing = await Promise.all([second.renew(sameState), second.renew({ ...sameState, requestId: randomUUID() })]);
      assert.equal(competing.filter(row => row.ok).length, 1);
      assert.equal(await db.rewardPilotAuditEvent.count({ where: { organisationId: other.organisation.id, action: "PILOT_ACCESS_RENEWED" } }), 1);
    });
    await t.test("renewal does not reactivate old invitation; separate explicit reissue and acceptance work", async () => {
      const f = await fixture(db), api = await service(db, f), input = await inputFor(api, f);
      assert.equal((await api.renew(input)).ok, true);
      const { createShopperAuthService } = await import("../lib/retail-rewards/shopper-auth-service.mjs");
      const auth = createShopperAuthService({ db, env: f.env, clock: () => NOW });
      const password = "Only a synthetic local passphrase!";
      assert.equal((await auth.acceptInvite({ token: f.oldInvitationToken, password })).ok, false);
      const reissued = await api.reissue({ ...ids(f), confirm: true }); assert.equal(reissued.ok, true, reissued.code);
      assert.notEqual(reissued.invitationToken, f.oldInvitationToken); assert.equal(reissued.membershipExpiresAt, END.toISOString());
      await assertDeniedUnchanged(db, f, () => api.renew(input)); // State changed after the recorded renewal.
      const accepted = await auth.acceptInvite({ token: reissued.invitationToken, password }); assert.equal(accepted.ok, true, accepted.code);
      assert.equal((await db.rewardShopper.findUnique({ where: { id: f.shopperId } })).status, "ACTIVE");
      assert.equal(await db.rewardShopperCredential.count({ where: { shopperId: f.shopperId } }), 1);
      assert.equal(await db.rewardShopperSession.count({ where: { shopperId: f.shopperId } }), 1);
      assert.equal((await auth.acceptInvite({ token: reissued.invitationToken, password })).ok, false);
      assert.equal((await api.renewalReview(ids(f))).ok, false);
      assert.equal((await createShopperAuthService({ db, env: { ...f.env, RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, clock: () => NOW })
        .login({ email: f.email, password })).code, "FEATURE_DISABLED");
    });
    await t.test("malformed confirmation, stale pins and outside-window expiry never write", async () => {
      const f = await fixture(db), api = await service(db, f), input = await inputFor(api, f);
      for (const patch of [{ confirm: false }, { expectedState: "0".repeat(64) }, { requestId: "not-a-uuid" },
        { expiresAt: NOW.toISOString() }, { expiresAt: new Date(+NOW + 7200001).toISOString() }, { expiresAt: "not-a-date" }]) {
        await assertDeniedUnchanged(db, f, () => api.renew({ ...input, ...patch }));
      }
      await db.rewardEntitlementGrant.update({ where: { id: f.grant.id }, data: { monthlyRedemptions: 5 } });
      await assertDeniedUnchanged(db, f, () => api.renew(input));
    });
    await t.test("foreign tenant and changed target identity cannot be substituted", async () => {
      const f = await fixture(db), foreign = await fixture(db), env = { ...f.env,
        RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: JSON.stringify([f.organisation.id, foreign.organisation.id]) };
      const api = await service(db, f, { env }), input = await inputFor(api, f);
      await assertDeniedUnchanged(db, f, () => api.renew({ ...input, organisationId: foreign.organisation.id }));
      await assertDeniedUnchanged(db, foreign, () => api.renew({ ...input, shopperId: foreign.shopperId }));
      assert.equal((await api.renewalReview({ ...ids(f), shopperId: foreign.shopperId })).ok, false);
    });
    await t.test("active, credentialed, previously signed-in or colliding identities fail closed", async () => {
      const changes = [
        (f) => db.rewardShopper.update({ where: { id: f.shopperId }, data: { status: "ACTIVE" } }),
        (f) => db.rewardShopper.update({ where: { id: f.shopperId }, data: { authVersion: 2 } }),
        (f) => db.rewardShopperCredential.create({ data: { shopperId: f.shopperId, emailCanonical: f.email, passwordHash: HASH } }),
        (f) => db.rewardShopperSession.create({ data: { shopperId: f.shopperId, authVersion: 1, tokenHash: randomBytes(32).toString("hex"),
          createdAt: BEFORE, expiresAt: EXPIRED, revokedAt: EXPIRED } }),
        (f) => db.user.create({ data: { email: f.email.toUpperCase(), passwordHash: HASH, role: "OWNER", name: "Synthetic conflicting identity" } }),
        (f) => db.rewardShopperInvitation.update({ where: { shopperId: f.shopperId }, data: { revokedAt: null } }),
        (f) => db.rewardShopperMembership.update({ where: { shopperId: f.shopperId }, data: { revokedAt: EXPIRED } }),
        (f) => db.rewardEntitlementGrant.update({ where: { id: f.grant.id }, data: { expiresAt: END } }),
        (f) => db.rewardProgram.update({ where: { id: f.program.id }, data: { status: "PAUSED" } }),
        (f) => db.subscription.update({ where: { id: f.subscription.id }, data: { status: "CANCELLED" } })
      ];
      for (const change of changes) {
        const f = await fixture(db), api = await service(db, f), input = await inputFor(api, f);
        await change(f); assert.equal((await api.renewalReview(ids(f))).ok, false);
        await assertDeniedUnchanged(db, f, () => api.renew(input));
      }
    });
    await t.test("a second tenant enrollment prevents tenant-wide grant renewal", async () => {
      const f = await fixture(db), api = await service(db, f), input = await inputFor(api, f);
      const second = await db.rewardShopper.create({ data: { displayName: "Other synthetic shopper", status: "DISABLED" } });
      await db.rewardPilotShopperEnrollment.create({ data: { shopperId: second.id, organisationId: f.organisation.id, createdByUserId: f.user.id, createdAt: BEFORE } });
      await assertDeniedUnchanged(db, f, () => api.renew(input));
    });
    await t.test("existing target use, outstanding published offers and staff authority require separate review", async () => {
      for (const mode of ["history", "offer", "staff"]) {
        const f = await fixture(db), api = await service(db, f), input = await inputFor(api, f);
        if (mode === "history") await history(db, f, f.shopperId);
        if (mode === "offer") await offer(db, f, END);
        if (mode === "staff") {
          const member = await db.organisationMember.create({ data: { organisationId: f.organisation.id, userId: f.user.id, role: "OWNER" } });
          await db.rewardStaffGrant.create({ data: { organisationId: f.organisation.id, organisationMemberId: member.id, scope: "LOCATIONS",
            locationId: f.location.id, capabilities: ["REDEEM"], startsAt: BEFORE, expiresAt: END } });
        }
        assert.equal((await api.renewalReview(ids(f))).ok, false, mode);
        await assertDeniedUnchanged(db, f, () => api.renew(input));
      }
    });
    await t.test("final authority loss, expiry or flags-off rolls back both expiry writes and the audit", async () => {
      for (const mode of ["role", "expiry", "flags"]) {
        const f = await fixture(db), normal = await service(db, f), input = await inputFor(normal, f), before = await state(db, f);
        let reads = 0, time = NOW; const env = { ...f.env };
        const api = await service(db, f, { env, clock: () => time, loadContext: async client => {
          const loaded = await f.loadContext(client); reads++;
          if (reads >= 3) {
            if (mode === "role") return { ...loaded, user: { ...loaded.user, role: "OWNER" } };
            if (mode === "expiry") time = END;
            if (mode === "flags") env.RUVANAS_RETAIL_REWARDS_ENABLED = "false";
          }
          return loaded;
        } });
        assert.equal((await api.renew(input)).ok, false, mode); assert.ok(reads >= 3, "Must reach final authorization after writes.");
        assert.deepEqual(await state(db, f), before, mode);
      }
    });
    await t.test("committed grant/session revocation wins over a renewal waiting on row locks", async () => {
      for (const model of ["grant", "session"]) {
        const f = await fixture(db), api = await service(db, f), input = await inputFor(api, f), before = await state(db, f);
        assert.equal((await revokeWhileWaiting(db, f, api, input, model)).ok, false, model);
        const after = await state(db, f);
        assert.deepEqual(after.membership, before.membership); assert.deepEqual(after.audits, before.audits);
        assert.equal(after.grant.expiresAt.toISOString(), EXPIRED.toISOString());
        assert.deepEqual(after.invitation, before.invitation);
      }
    });
    await t.test("renewal audit stays immutable and SQL rejects unexpected metadata or action shapes", async () => {
      const f = await fixture(db), api = await service(db, f), input = await inputFor(api, f);
      assert.equal((await api.renew(input)).ok, true);
      const audit = await db.rewardPilotAuditEvent.findFirst({ where: { organisationId: f.organisation.id, action: "PILOT_ACCESS_RENEWED" } });
      await assert.rejects(db.rewardPilotAuditEvent.update({ where: { id: audit.id }, data: { actorUserId: "changed" } }));
      await assert.rejects(db.rewardPilotAuditEvent.delete({ where: { id: audit.id } }));
      await assert.rejects(db.rewardPilotShopperEnrollment.update({ where: { shopperId: f.shopperId }, data: { organisationId: f.otherOrganisation.id } }));
      // Setup prevents identity rebinding; its pre-existing migration explicitly
      // permits deletion at the DB layer. Renewal itself must preserve it.
      await assert.rejects(db.rewardShopperSetup.update({ where: { shopperId: f.shopperId }, data: { organisationId: f.otherOrganisation.id } }));
      assert.deepEqual(await db.rewardShopperSetup.findUnique({ where: { shopperId: f.shopperId } }), f.setup);
      for (const metadataJson of [{ ...audit.metadataJson, token: "synthetic-secret-forbidden" }, { ...audit.metadataJson, requestHash: "bad" },
        { ...audit.metadataJson, membershipVersion: 0 }, { ...audit.metadataJson, status: "INVITED" }]) {
        await assert.rejects(db.rewardPilotAuditEvent.create({ data: { organisationId: f.organisation.id, actorUserId: f.user.id,
          action: "PILOT_ACCESS_RENEWED", targetType: "PROGRAM", targetId: f.program.id, requestId: randomUUID(), metadataJson } }));
      }
      assert.deepEqual(await db.rewardPilotAuditEvent.findUnique({ where: { id: audit.id } }), audit);
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_catalog.set_config('search_path', '', true)`;
        const [valid] = await tx.$queryRaw`SELECT public.ruvanas_rewards_pilot_renewal_metadata_valid(${JSON.stringify(audit.metadataJson)}::jsonb) AS valid`;
        const [invalid] = await tx.$queryRaw`SELECT public.ruvanas_rewards_pilot_renewal_metadata_valid(${JSON.stringify({ ...audit.metadataJson, shopperId: "../outside" })}::jsonb) AS valid`;
        assert.equal(valid.valid, true, "Renewal metadata must survive the empty search_path used by logical restores.");
        assert.equal(invalid.valid, false);
      });
      const legacy = { organisationId: f.organisation.id, actorUserId: f.user.id, action: "INVITATION_REVOKED",
        targetType: "SHOPPER", targetId: f.shopperId, metadataJson: { status: "REVOKED" } };
      const first = await db.rewardPilotAuditEvent.create({ data: legacy });
      const second = await db.rewardPilotAuditEvent.create({ data: legacy });
      assert.equal(first.requestId, null); assert.equal(second.requestId, null);
      assert.notEqual(first.id, second.id, "Existing service audit writes with NULL request IDs remain appendable.");
    });
  } finally { await db.$disconnect(); }
});
