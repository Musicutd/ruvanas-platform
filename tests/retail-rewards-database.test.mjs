import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

// These cases include the existing global subscriber reset. Require a dedicated
// owned cluster or the separate ephemeral CI job, never just DATABASE_URL.
const requested = process.env.RUVANAS_REWARDS_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const CI_DATABASE_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const NOW = new Date("2026-11-13T12:00:00Z"), END = new Date("2027-11-13T12:00:00Z");
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const rollback = new Error("ROLL_BACK_SYNTHETIC_REWARDS_FIXTURE");

function rewardsDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1", "Database tests require explicit opt-in.");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_LOCAL_TEST, undefined, "CI and local modes cannot be combined.");
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined);
    assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
      GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) {
      assert.equal(env[key], value, `Unexpected CI identity: ${key}.`);
    }
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
    assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.ok(env.DATABASE_URL === CI_DATABASE_URL && env.RUVANAS_REWARDS_DATABASE_URL === CI_DATABASE_URL,
      "Only the dedicated loopback CI database URL is permitted.");
    return { mode: "CI", url: new URL(CI_DATABASE_URL) };
  }
  assert.equal(env.RUVANAS_REWARDS_LOCAL_TEST, "1", "Use an explicit owned local fixture.");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "rr01b_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.ok(["/ruvanas_rewards_full", "/ruvanas_rewards_upgrade"].includes(url.pathname));
  assert.equal(url.search, "?connection_limit=4");
  assert.ok(env.DATABASE_URL === url.href, "The local fixture URLs must agree.");
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr01b-20261113\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

async function openRewardsDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  // All configuration validation runs before constructing a client or querying.
  const target = rewardsDatabaseTarget(env, options);
  const db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1);
    const [identity] = rows;
    if (target.mode === "CI") {
      assert.equal(identity.database, "ruvanas_rewards_ci"); assert.equal(identity.role, "rewards_ci");
      assert.equal(identity.port, 5432); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.ok(identity.version >= 160000 && identity.version < 170000, "This job requires PostgreSQL 16.");
      // The client is pinned to loopback; the service reports its Docker-side IP.
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.ok(samePath(identity.directory, target.cluster));
      assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.role, "rr01b_qa");
      assert.equal(identity.host, "127.0.0.1"); assert.equal(identity.port, Number(target.url.port));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

async function assertEmptyCiBaseline(db) {
  // Three existing migrations deliberately seed QA organisations/subscriptions
  // and a media profile. Preserve those exact seeds; every other application
  // table must be empty before any destructive reset test is attempted.
  const tables = await db.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename NOT IN ('_prisma_migrations','Plan','Organisation','Subscription','OrganisationMediaProfile') ORDER BY tablename`);
  assert.ok(tables.length > 0);
  const counts = await db.$queryRawUnsafe(tables.map(({ tablename }) =>
    `SELECT '${tablename.replaceAll("'", "''")}' AS name,count(*)::bigint AS count FROM "${tablename.replaceAll('"', '""')}"`).join(" UNION ALL "));
  assert.ok(counts.every(row => row.count === 0n), "The dedicated CI database must contain zero non-migration application rows.");
  const [{ snapshot }] = await db.$queryRawUnsafe(`SELECT jsonb_build_object(
    'plans',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM "Plan" t),
    'organisations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM "Organisation" t),
    'subscriptions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM "Subscription" t),
    'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM "OrganisationMediaProfile" t)) AS snapshot`);
  assert.ok(isDeepStrictEqual(snapshot.organisations.map(({ id, name, slug }) => ({ id, name, slug })), [
    { id: "qa-faith-organisation", name: "Ruvanas Faith QA", slug: "ruvanas-faith-qa" },
    { id: "qa-health-organisation", name: "Ruvanas Health QA", slug: "ruvanas-health-qa" },
    { id: "qa-organisations-organisation", name: "Ruvanas Organisations QA", slug: "ruvanas-organisations-qa" }
  ]), "Only exact historical migration seed organisations may exist.");
  assert.ok(isDeepStrictEqual(snapshot.subscriptions.map(({ id, organisationId, status, planId }) => ({ id, organisationId, status,
    planCode: snapshot.plans.find(plan => plan.id === planId)?.code })), [
    { id: "qa-faith-subscription", organisationId: "qa-faith-organisation", status: "TRIAL", planCode: "FAITH_PRO" },
    { id: "qa-health-subscription", organisationId: "qa-health-organisation", status: "TRIAL", planCode: "HEALTH_PRO" },
    { id: "qa-organisations-subscription", organisationId: "qa-organisations-organisation", status: "TRIAL", planCode: "ORGANISATIONS_PRO" }
  ]), "Only exact historical migration seed subscriptions may exist.");
  assert.ok(isDeepStrictEqual(snapshot.profiles.map(({ id, organisationId }) => ({ id, organisationId })), [
    { id: "qa-organisations-media-profile", organisationId: "qa-organisations-organisation" }
  ]), "Only the historical migration seed profile may exist.");
  return snapshot;
}

const ciFixtureEnvironment = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_DATABASE_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_DATABASE_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "1" });

test("Rewards CI guard rejects malformed or shared database configuration before any client or query", async () => {
  assert.equal(rewardsDatabaseTarget(ciFixtureEnvironment(), { platform: "linux" }).mode, "CI");
  const forbidden = [
    { RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" }, { RUVANAS_REWARDS_LOCAL_TEST: "1" },
    { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/foreign" }, { GITHUB_ACTIONS: "false" }, { CI: "false" },
    { GITHUB_WORKFLOW: "Other" }, { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { RUNNER_OS: "Windows" },
    { GITHUB_REPOSITORY: undefined }, { GITHUB_RUN_ID: undefined }, { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ATTEMPT: "0" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ruvanas" },
    { DATABASE_URL: "postgresql://rewards_ci:rewards_ci@production.example/ruvanas_rewards_ci" },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_DATABASE_URL}?schema=public` },
    { RUVANAS_REWARDS_DATABASE_URL: CI_DATABASE_URL.replace("127.0.0.1", "localhost") },
    { DATABASE_URL: CI_DATABASE_URL.replace("5432", "5433") }, { DATABASE_URL: undefined }
  ];
  for (const changes of forbidden) {
    let clients = 0;
    await assert.rejects(openRewardsDatabase({ ...ciFixtureEnvironment(), ...changes }, { platform: "linux",
      createClient: () => { clients++; throw new Error("No client or query is permitted."); } }));
    assert.equal(clients, 0, "Malformed CI guard must fail before database access.");
  }
  let clients = 0;
  await assert.rejects(openRewardsDatabase(ciFixtureEnvironment(), { platform: "win32", createClient: () => { clients++; } }));
  assert.equal(clients, 0);
});

test("Rewards fixture identity mismatch disconnects after the read-only identity query", async () => {
  const valid = { database: "ruvanas_rewards_ci", role: "rewards_ci", port: 5432,
    directory: "/var/lib/postgresql/data", version: 160012, host: "172.18.0.2" };
  for (const changes of [{ database: "ruvanas" }, { role: "postgres" }, { port: 5433 }, { directory: "/production" },
    { version: 150010 }, { version: 180000 }, { host: null }]) {
    let queries = 0, disconnected = 0;
    await assert.rejects(openRewardsDatabase(ciFixtureEnvironment(), { platform: "linux", createClient: () => ({
      $queryRawUnsafe: async () => { queries++; return [{ ...valid, ...changes }]; },
      $disconnect: async () => { disconnected++; }
    }) }));
    assert.equal(queries, 1); assert.equal(disconnected, 1);
  }
});

test("Rewards CI baseline rejects customer rows and altered migration seeds before test transactions", async () => {
  const snapshot = {
    plans: [{ id: "faith", code: "FAITH_PRO" }, { id: "health", code: "HEALTH_PRO" }, { id: "organisations", code: "ORGANISATIONS_PRO" }],
    organisations: [
      { id: "qa-faith-organisation", name: "Ruvanas Faith QA", slug: "ruvanas-faith-qa" },
      { id: "qa-health-organisation", name: "Ruvanas Health QA", slug: "ruvanas-health-qa" },
      { id: "qa-organisations-organisation", name: "Ruvanas Organisations QA", slug: "ruvanas-organisations-qa" }
    ],
    subscriptions: [
      { id: "qa-faith-subscription", organisationId: "qa-faith-organisation", status: "TRIAL", planId: "faith" },
      { id: "qa-health-subscription", organisationId: "qa-health-organisation", status: "TRIAL", planId: "health" },
      { id: "qa-organisations-subscription", organisationId: "qa-organisations-organisation", status: "TRIAL", planId: "organisations" }
    ],
    profiles: [{ id: "qa-organisations-media-profile", organisationId: "qa-organisations-organisation" }]
  };
  for (const change of [
    state => { state.count = 1n; }, state => { state.snapshot.organisations.push({ id: "customer" }); },
    state => { state.snapshot.organisations[0].name = "Different tenant"; },
    state => { state.snapshot.subscriptions[0].organisationId = "foreign"; },
    state => { state.snapshot.subscriptions[0].status = "ACTIVE"; },
    state => { state.snapshot.profiles[0].organisationId = "foreign"; }
  ]) {
    const state = { snapshot: structuredClone(snapshot), count: 0n, reads: 0, transactions: 0 }; change(state);
    const db = {
      $queryRawUnsafe: async () => {
        state.reads++;
        if (state.reads === 1) return [{ tablename: "User" }];
        if (state.reads === 2) return [{ name: "User", count: state.count }];
        return [{ snapshot: state.snapshot }];
      },
      $transaction: () => { state.transactions++; throw new Error("No mutation is permitted."); }
    };
    await assert.rejects(assertEmptyCiBaseline(db));
    assert.equal(state.transactions, 0);
    assert.equal(state.reads, state.count ? 2 : 3);
  }
});

async function syntheticTransaction(db, operation) {
  try {
    await db.$transaction(async tx => { await operation(tx); throw rollback; }, { maxWait: 10000, timeout: 300000 });
    assert.fail("Fixture transaction must roll back.");
  } catch (error) { if (error !== rollback) throw error; }
}
async function rejectsSql(tx, query, params = [], code = "23514") {
  await tx.$executeRawUnsafe("SAVEPOINT reward_rejected_write");
  let failure;
  try { await tx.$executeRawUnsafe(query, ...params); } catch (error) { failure = error; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT reward_rejected_write");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT reward_rejected_write");
  assert.ok(failure, `PostgreSQL accepted forbidden SQL: ${query}`);
  const codes = Array.isArray(code) ? code : [code];
  assert.ok(codes.includes(failure.meta?.code), `Unexpected PostgreSQL rejection for ${query}: ${failure.message}`);
}
async function fixture(tx) {
  const prefix = `rr01b_${randomUUID().replaceAll("-", "")}`;
  const plan = await tx.plan.create({ data: { name: prefix, code: prefix.toUpperCase(), productFamily: "RETAIL",
    monthlyPriceCents: 1000, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128, retailRadioEnabled: true } });
  const tenants = [];
  for (const label of ["own", "foreign"]) {
    const organisation = await tx.organisation.create({ data: { name: `Synthetic ${label}`, slug: `${prefix}-${label}` } });
    const user = await tx.user.create({ data: { email: `${prefix}-${label}@example.invalid`, passwordHash: "synthetic-not-a-password", role: "OWNER" } });
    const member = await tx.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role: "OWNER" } });
    const subscription = await tx.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE", currentPeriodEnd: END } });
    const location = await tx.location.create({ data: { organisationId: organisation.id, name: `Synthetic ${label} shop`, slug: label, status: "ACTIVE" } });
    tenants.push({ organisation, user, member, subscription, location });
  }
  const [own, foreign] = tenants;
  const program = await tx.rewardProgram.create({ data: { organisationId: own.organisation.id } });
  const grant = await tx.rewardEntitlementGrant.create({ data: { organisationId: own.organisation.id, subscriptionId: own.subscription.id,
    tier: "REWARDS_STARTER", startsAt: NOW, expiresAt: END, activeOffers: 3, locations: 2, staffSeats: 2,
    monthlyRedemptions: 100, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false } });
  const staff = await tx.rewardStaffGrant.create({ data: { organisationId: own.organisation.id, organisationMemberId: own.member.id,
    scope: "LOCATIONS", locationId: own.location.id, capabilities: ["READ", "REDEEM"], startsAt: NOW, expiresAt: END } });
  return { prefix, plan, own, foreign, program, grant, staff };
}
function auditData(f) {
  return { organisationId: f.own.organisation.id, actorUserId: f.own.user.id, actorOrganisationMemberId: f.own.member.id,
    action: "STAFF_GRANT_CREATED", targetType: "STAFF_GRANT", targetId: f.staff.id, requestId: `${f.prefix}_request`, metadata: {} };
}

test("Rewards PostgreSQL constraints, audit evidence and reset compatibility on an owned disposable cluster", {
  skip: !requested && "Use the dedicated Rewards CI job or owned local harness; ordinary application databases are forbidden."
}, async t => {
  const { db, target } = await openRewardsDatabase(process.env);
  try {
    // Exercise the same zero-data sentinel during the clean local rehearsal.
    // The separately owned upgrade fixture intentionally has a legacy tenant.
    const baselineRequired = target.mode === "CI" || target.url.pathname === "/ruvanas_rewards_full";
    const ciBaseline = baselineRequired ? await assertEmptyCiBaseline(db) : null;

    await t.test("new rows remain disabled and the real adapter preserves exact tenant projections", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      assert.equal(f.program.status, "DISABLED"); assert.equal(f.program.networkOptIn, false);
      assert.equal(f.grant.status, "DISABLED"); assert.equal(f.grant.capability, "RETAIL_REWARDS");
      assert.equal(f.grant.source, "MANUAL_INTERNAL"); assert.equal(f.grant.limitsVersion, 1);
      assert.equal(await tx.rewardProgram.count({ where: { organisationId: f.foreign.organisation.id } }), 0);
      assert.equal(await tx.rewardEntitlementGrant.count({ where: { organisationId: f.foreign.organisation.id } }), 0);
      const { createRewardsDatabaseAdapter } = await import("../lib/retail-rewards/database-adapter.mjs");
      const adapter = createRewardsDatabaseAdapter(tx);
      const state = await adapter.loadRewardsState({ organisationId: f.own.organisation.id, subscriptionId: f.own.subscription.id });
      assert.equal(state.program.id, f.program.id); assert.equal(state.grant.id, f.grant.id);
      assert.deepEqual(state.grant.limits, { activeOffers: 3, locations: 2, staffSeats: 2, monthlyRedemptions: 100,
        analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false });
      assert.equal((await adapter.loadRewardsState({ organisationId: f.own.organisation.id, subscriptionId: f.foreign.subscription.id })).grant, null);
      assert.deepEqual((await adapter.loadStaffGrants({ organisationId: f.own.organisation.id, organisationMemberId: f.own.member.id }))[0].locationIds, [f.own.location.id]);
      assert.deepEqual(await adapter.loadStaffGrants({ organisationId: f.own.organisation.id, organisationMemberId: f.foreign.member.id }), []);
      assert.equal(await adapter.loadLocation({ organisationId: f.own.organisation.id, locationId: f.foreign.location.id }), null);
    }));

    await t.test("composite foreign keys reject cross-tenant subscription, membership and location links", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      await rejectsSql(tx, 'UPDATE "RewardEntitlementGrant" SET "subscriptionId"=$1 WHERE id=$2', [f.foreign.subscription.id, f.grant.id], "23503");
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET "organisationMemberId"=$1 WHERE id=$2', [f.foreign.member.id, f.staff.id], "23503");
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET "locationId"=$1 WHERE id=$2', [f.foreign.location.id, f.staff.id], "23503");
      // PostgreSQL versions distinguish RESTRICT violation (23001) from the
      // general foreign-key violation (23503); either must reject the deletion.
      await rejectsSql(tx, 'DELETE FROM "Location" WHERE id=$1', [f.own.location.id], ["23001", "23503"]);
      await rejectsSql(tx, 'DELETE FROM "Subscription" WHERE id=$1', [f.own.subscription.id], ["23001", "23503"]);
      await rejectsSql(tx, 'UPDATE "RewardProgram" SET "organisationId"=$1 WHERE id=$2', ["missing-organisation", f.program.id], "23503");
    }));

    await t.test("grant limits, sources and finite expiry are enforced by PostgreSQL", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      for (const column of ["activeOffers", "locations", "staffSeats", "monthlyRedemptions", "analyticsRetentionDays"]) {
        for (const value of [-1, 1000000001]) await rejectsSql(tx, `UPDATE "RewardEntitlementGrant" SET "${column}"=$1 WHERE id=$2`, [value, f.grant.id]);
        await rejectsSql(tx, `UPDATE "RewardEntitlementGrant" SET "${column}"=NULL WHERE id=$1`, [f.grant.id], "23502");
      }
      for (const [column, value] of [["capability", "OTHER"], ["source", "REQUEST_BODY"]]) {
        await rejectsSql(tx, `UPDATE "RewardEntitlementGrant" SET "${column}"=$1 WHERE id=$2`, [value, f.grant.id]);
      }
      await rejectsSql(tx, 'UPDATE "RewardEntitlementGrant" SET "limitsVersion"=2 WHERE id=$1', [f.grant.id]);
      for (const table of ["RewardEntitlementGrant", "RewardStaffGrant"]) {
        const id = table === "RewardEntitlementGrant" ? f.grant.id : f.staff.id;
        await rejectsSql(tx, `UPDATE "${table}" SET "expiresAt"="startsAt" WHERE id=$1`, [id]);
        await rejectsSql(tx, `UPDATE "${table}" SET "expiresAt"='infinity' WHERE id=$1`, [id]);
        await rejectsSql(tx, `UPDATE "${table}" SET "startsAt"='-infinity' WHERE id=$1`, [id]);
        await rejectsSql(tx, `UPDATE "${table}" SET "revokedAt"='infinity' WHERE id=$1`, [id]);
      }
    }));

    await t.test("staff scope, enum capabilities and single current scope cannot broaden accidentally", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET scope=\'ALL_LOCATIONS\' WHERE id=$1', [f.staff.id]);
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET "locationId"=NULL WHERE id=$1', [f.staff.id]);
      for (const array of ["ARRAY[]", "ARRAY['READ','READ']", "ARRAY['READ',NULL]", "ARRAY[['READ'],['REDEEM']]"]) {
        await rejectsSql(tx, `UPDATE "RewardStaffGrant" SET capabilities=${array}::"RewardAction"[] WHERE id=$1`, [f.staff.id]);
      }
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET capabilities=ARRAY[\'ADMIN\']::"RewardAction"[] WHERE id=$1', [f.staff.id], "22P02");
      await rejectsSql(tx, 'INSERT INTO "RewardStaffGrant" SELECT $1,"organisationId","organisationMemberId",scope,"locationId",capabilities,"startsAt","expiresAt","revokedAt","createdAt","updatedAt" FROM "RewardStaffGrant" WHERE id=$2', [`${f.prefix}_duplicate`, f.staff.id], "23505");
      await tx.rewardStaffGrant.create({ data: { organisationId: f.own.organisation.id, organisationMemberId: f.own.member.id,
        scope: "ALL_LOCATIONS", capabilities: ["READ"], startsAt: NOW, expiresAt: END } });
      await rejectsSql(tx, 'INSERT INTO "RewardStaffGrant" (id,"organisationId","organisationMemberId",scope,capabilities,"startsAt","expiresAt","updatedAt") VALUES ($1,$2,$3,\'ALL_LOCATIONS\',ARRAY[\'READ\']::"RewardAction"[],$4,$5,$4)',
        [`${f.prefix}_all_duplicate`, f.own.organisation.id, f.own.member.id, NOW, END], "23505");
    }));

    await t.test("audit rows reject mutation and evidence survives deletion of current membership authority", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), event = await tx.rewardAuditEvent.create({ data: auditData(f) });
      await rejectsSql(tx, 'UPDATE "RewardAuditEvent" SET metadata=\'{}\'::jsonb WHERE id=$1', [event.id], "55000");
      await rejectsSql(tx, 'DELETE FROM "RewardAuditEvent" WHERE id=$1', [event.id], "55000");
      await rejectsSql(tx, 'TRUNCATE TABLE "RewardAuditEvent"', [], "55000");
      await tx.organisationMember.delete({ where: { id: f.own.member.id } });
      assert.equal(await tx.rewardStaffGrant.count({ where: { organisationMemberId: f.own.member.id } }), 0);
      assert.deepEqual(await tx.rewardAuditEvent.findUnique({ where: { id: event.id } }), event);
      assert.equal((await tx.rewardAuditEvent.findUnique({ where: { id: event.id } })).actorOrganisationMemberId, f.own.member.id);
      await rejectsSql(tx, 'DELETE FROM "Organisation" WHERE id=$1', [f.own.organisation.id], ["23001", "23503"]);
    }));

    await t.test("audit metadata admits typed policy snapshots and rejects secrets or malformed fields", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      const metadata = { reasonCode: "MANUAL_INTERNAL", before: { status: "DISABLED", revokedAt: null },
        after: { status: "ACTIVE", scope: "LOCATIONS", locationId: f.own.location.id, organisationMemberId: f.own.member.id,
          capabilities: ["READ", "REDEEM"], startsAt: NOW.toISOString(), expiresAt: END.toISOString(),
          tier: "REWARDS_STARTER", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", limitsVersion: 1,
          activeOffers: 0, locations: 1000000000, exportEnabled: false, brandingEnabled: true, networkOptIn: false, timezone: "Europe/Malta" } };
      const accepted = await tx.rewardAuditEvent.create({ data: { ...auditData(f), metadata } });
      assert.deepEqual(accepted.metadata, metadata);
      for (const metadata of [{ secret: "sensitive" }, { token: "sensitive" }, { email: "identity@example.invalid" },
        { rawPayload: {} }, [], null, "text", { reason: { nested: true } }, { before: { unknown: true } },
        { before: null }, { after: [] }, { reasonCode: "arbitrary user text" }, { reasonCode: null },
        { before: { status: "x".repeat(17000) } }, { before: { activeOffers: -1 } }, { after: { activeOffers: 1000000001 } },
        { after: { activeOffers: 1.5 } }, { after: { activeOffers: "3" } }, { after: { activeOffers: null } },
        { after: { limitsVersion: 2 } }, { after: { exportEnabled: "true" } }, { after: { tier: "ADMIN" } },
        { after: { capability: "OTHER" } }, { after: { source: "REQUEST_BODY" } }, { after: { scope: "OTHER" } },
        { after: { locationId: "../../foreign" } }, { after: { organisationMemberId: null } },
        { after: { startsAt: "infinity" } }, { after: { expiresAt: "2026-02-30T12:00:00.000Z" } }, { after: { startsAt: null } },
        { after: { capabilities: [] } }, { after: { capabilities: ["READ", "READ"] } },
        { after: { capabilities: [null] } }, { after: { capabilities: ["ADMIN"] } }, { after: { timezone: " " } }]) {
        await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId",action,"targetType","targetId",metadata) VALUES ($1,$2,\'STAFF_GRANT_CREATED\',\'STAFF_GRANT\',$3,$4::jsonb)',
          [`${f.prefix}_${randomUUID()}`, f.own.organisation.id, f.staff.id, JSON.stringify(metadata)]);
      }
      await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId",action,"targetType","targetId") VALUES ($1,$2,\'STAFF_GRANT_CREATED\',\'PROGRAM\',$3)',
        [`${f.prefix}_bad_target`, f.own.organisation.id, f.staff.id]);
      await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId","actorOrganisationMemberId",action,"targetType","targetId") VALUES ($1,$2,$3,\'STAFF_GRANT_CREATED\',\'STAFF_GRANT\',$4)',
        [`${f.prefix}_bad_actor`, f.own.organisation.id, f.own.member.id, f.staff.id]);
    }));

    await t.test("subscriber reset remains compatible with empty Rewards tables", () => syntheticTransaction(db, async tx => {
      const prefix = `rr01b_reset_${randomUUID().replaceAll("-", "")}`;
      const actor = await tx.user.create({ data: { email: `${prefix}@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
      const organisation = await tx.organisation.create({ data: { name: "Synthetic reset tenant", slug: prefix } });
      const user = await tx.user.create({ data: { email: `${prefix}-target@example.invalid`, passwordHash: "synthetic" } });
      await tx.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id } });
      for (const delegate of ["rewardProgram", "rewardEntitlementGrant", "rewardStaffGrant", "rewardAuditEvent"]) assert.equal(await tx[delegate].count(), 0);
      await rejectsSql(tx, 'TRUNCATE TABLE "RewardAuditEvent"', [], "55000");
      const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION } = await import("../lib/subscriber-test-reset.mjs");
      const result = await resetSubscriberTestData({ $transaction: operation => operation(tx) }, {
        actor, retainedEmail: actor.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION
      });
      assert.ok(result.deletedOrganisations >= 1); assert.ok(result.deletedUsers >= 1);
      assert.equal(await tx.organisation.count(), 0); assert.equal(await tx.user.count(), 1);
      assert.equal((await tx.user.findUnique({ where: { id: actor.id } })).role, "SUPER_ADMIN");
    }));

    await t.test("subscriber reset fails atomically when Rewards evidence exists", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), event = await tx.rewardAuditEvent.create({ data: auditData(f) });
      const actor = await tx.user.create({ data: { email: `${f.prefix}-admin@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
      const before = {
        organisations: await tx.organisation.findMany({ orderBy: { id: "asc" } }), users: await tx.user.findMany({ orderBy: { id: "asc" } }),
        members: await tx.organisationMember.findMany({ orderBy: { id: "asc" } }),
        grants: await tx.rewardEntitlementGrant.findMany(), staff: await tx.rewardStaffGrant.findMany(), audit: await tx.rewardAuditEvent.findMany()
      };
      const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION } = await import("../lib/subscriber-test-reset.mjs");
      const nestedTransaction = async operation => {
        await tx.$executeRawUnsafe("SAVEPOINT reset_atomicity");
        try { const result = await operation(tx); await tx.$executeRawUnsafe("RELEASE SAVEPOINT reset_atomicity"); return result; }
        catch (error) { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT reset_atomicity"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT reset_atomicity"); throw error; }
      };
      await assert.rejects(resetSubscriberTestData({ $transaction: nestedTransaction }, {
        actor, retainedEmail: actor.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION
      }), error => error.code === "RESET_STAGE_REWARDAUDITEVENT");
      assert.deepEqual(await tx.organisation.findMany({ orderBy: { id: "asc" } }), before.organisations);
      assert.deepEqual(await tx.user.findMany({ orderBy: { id: "asc" } }), before.users);
      assert.deepEqual(await tx.organisationMember.findMany({ orderBy: { id: "asc" } }), before.members);
      assert.deepEqual(await tx.rewardEntitlementGrant.findMany(), before.grants);
      assert.deepEqual(await tx.rewardStaffGrant.findMany(), before.staff);
      assert.deepEqual(await tx.rewardAuditEvent.findMany(), before.audit);
      assert.deepEqual(await tx.rewardAuditEvent.findUnique({ where: { id: event.id } }), event);
    }));
    if (baselineRequired) assert.ok(isDeepStrictEqual(await assertEmptyCiBaseline(db), ciBaseline),
      "All synthetic tests must roll back and leave migration seeds unchanged.");
  } finally { await db.$disconnect(); }
});
