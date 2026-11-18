import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2027-11-14T12:00:00.000Z");
const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_OFFERS_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const rollback = new Error("ROLL_BACK_SYNTHETIC_REWARDS_OFFER_FIXTURE");

export function offerDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_OFFERS_LOCAL_TEST, undefined);
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
  assert.equal(env.RUVANAS_REWARDS_OFFERS_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "rr02_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.ok(["/ruvanas_rewards_offers_full", "/ruvanas_rewards_offers_upgrade"].includes(url.pathname));
  assert.equal(url.search, "?connection_limit=6"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr02-20261114\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

export async function openOfferDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = offerDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.ok(identity.version >= 160000 && identity.version < 170000);
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "rr02_qa"); assert.equal(identity.host, "127.0.0.1"); assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });

test("RR-02 database tests reject unowned targets before constructing a database client", async () => {
  assert.equal(offerDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_OFFERS_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/unknown" },
    { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_RUN_ID: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openOfferDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openOfferDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) }));
  assert.equal(disconnected, 1);
});

async function syntheticTransaction(db, operation) {
  try { await db.$transaction(async tx => { await operation(tx); throw rollback; }, { timeout: 120000 }); assert.fail("Expected fixture rollback."); }
  catch (error) { if (error !== rollback) throw error; }
}
async function rejectsSql(tx, query, params = [], code = "23514") {
  await tx.$executeRawUnsafe("SAVEPOINT reward_offer_rejected_write"); let error;
  try { await tx.$executeRawUnsafe(query, ...params); } catch (caught) { error = caught; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT reward_offer_rejected_write");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT reward_offer_rejected_write");
  assert.ok(error, `Forbidden SQL was accepted: ${query}`);
  assert.ok((Array.isArray(code) ? code : [code]).includes(error.meta?.code), `Unexpected SQL rejection: ${error.message}`);
}
function terms(locationIds, title = "10% after a EUR 50 spend") {
  return { schemaVersion: 1, title, description: "Synthetic coupon", category: "HOME", type: "PERCENT_OFF",
    percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000,
    exclusions: "Gift cards", legalTerms: "Synthetic test terms only.", combinable: false,
    startsAt: NOW.toISOString(), endsAt: END.toISOString(), timezone: "Europe/Malta", locationIds,
    usage: "REUSABLE", totalLimit: 100, perShopperLimit: 10, perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED" };
}
async function fixture(db, { activeOffers = 1, locations = 2 } = {}) {
  const prefix = `rr02_${randomUUID().replaceAll("-", "")}`;
  const plan = await db.plan.create({ data: { name: prefix, code: prefix.toUpperCase(), productFamily: "RETAIL", active: true,
    monthlyPriceCents: 1000, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128, retailRadioEnabled: true } });
  const tenants = [];
  for (const label of ["own", "foreign"]) {
    const organisation = await db.organisation.create({ data: { name: `Synthetic ${label}`, slug: `${prefix}-${label}` } });
    const user = await db.user.create({ data: { email: `${prefix}-${label}@example.invalid`, passwordHash: "synthetic-not-a-password", role: "OWNER" } });
    const member = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role: "OWNER" } });
    const subscription = await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE", currentPeriodEnd: END } });
    const location = await db.location.create({ data: { organisationId: organisation.id, name: `Synthetic ${label} shop`, slug: label, status: "ACTIVE" } });
    const program = await db.rewardProgram.create({ data: { organisationId: organisation.id, status: "ACTIVE" } });
    const grant = await db.rewardEntitlementGrant.create({ data: { organisationId: organisation.id, subscriptionId: subscription.id,
      tier: "REWARDS_STARTER", status: "ACTIVE", startsAt: new Date("2026-01-01T00:00:00Z"), expiresAt: END,
      activeOffers, locations, staffSeats: 3, monthlyRedemptions: 100, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false } });
    const session = await db.session.create({ data: { userId: user.id, activeOrganisationId: organisation.id,
      tokenHash: `${prefix}-${label}-synthetic-hash`, expiresAt: END, authMethod: "PASSWORD" } });
    tenants.push({ organisation, user, member, subscription, location, program, grant, session });
  }
  return { prefix, plan, own: tenants[0], foreign: tenants[1] };
}
function draftData(tenant, title) {
  return { organisationId: tenant.organisation.id, programId: tenant.program.id, draft: terms([tenant.location.id], title),
    createdByUserId: tenant.user.id, updatedByUserId: tenant.user.id };
}
function freshContext(db, tenant) {
  return async (tx = db) => {
    const session = await tx.session.findUnique({ where: { id: tenant.session.id } });
    const user = await tx.user.findUnique({ where: { id: tenant.user.id }, include: { privatePreviewAccess: true } });
    const memberships = await tx.organisationMember.findMany({ where: { userId: tenant.user.id },
      include: { organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } } } });
    return { session, user, memberships, membership: memberships.find(row => row.organisationId === session?.activeOrganisationId) || null };
  };
}

test("RR-02 PostgreSQL offer constraints, immutable terms and transactional service isolation", {
  skip: !requested && "Requires an owned disposable RR-02 cluster or the dedicated Rewards CI database."
}, async t => {
  const { db, target } = await openOfferDatabase(process.env);
  try {
    // Only a fresh migration fixture may enter this suite. It deliberately ends
    // with committed synthetic concurrency evidence inside a disposable cluster.
    for (const model of ["rewardOffer", "rewardOfferLocation", "rewardOfferRevision", "rewardAuditEvent", "rewardProgram"])
      assert.equal(await db[model].count(), 0, "Expected a fresh isolated fixture, never application data.");
    if (target.mode === "CI") {
      assert.equal(await db.user.count(), 0); assert.equal(await db.location.count(), 0);
      const organisations = await db.organisation.findMany({ select: { id: true }, orderBy: { id: "asc" } });
      assert.deepEqual(organisations.map(row => row.id), ["qa-faith-organisation", "qa-health-organisation", "qa-organisations-organisation"]);
    }

    await t.test("same-tenant program, location, revision and published-pointer foreign keys", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), offer = await tx.rewardOffer.create({ data: draftData(f.own) });
      await rejectsSql(tx, 'UPDATE "RewardOffer" SET "programId"=$1 WHERE id=$2', [f.foreign.program.id, offer.id], "23503");
      await rejectsSql(tx, 'INSERT INTO "RewardOfferLocation" ("organisationId","offerId","locationId",scope) VALUES ($1,$2,$3,\'DRAFT\')',
        [f.own.organisation.id, offer.id, f.foreign.location.id], "23503");
      await rejectsSql(tx, 'INSERT INTO "RewardOfferRevision" (id,"organisationId","offerId",revision,terms,"actorUserId") VALUES ($1,$2,$3,1,$4::jsonb,$5)',
        [`${f.prefix}_foreignrevision`, f.foreign.organisation.id, offer.id, JSON.stringify(offer.draft), f.own.user.id], "23503");
      await rejectsSql(tx, 'UPDATE "RewardOffer" SET state=\'PUBLISHED\',"lastRevision"=1,"publishedRevision"=1,"publishedStartsAt"=$1,"publishedEndsAt"=$2 WHERE id=$3',
        [NOW, END, offer.id], "23503");
      await tx.rewardOfferLocation.create({ data: { organisationId: f.own.organisation.id, offerId: offer.id, locationId: f.own.location.id, scope: "DRAFT" } });
      await rejectsSql(tx, 'DELETE FROM "Location" WHERE id=$1', [f.own.location.id], ["23503", "23001"]);
    }));

    await t.test("offer counters, publication state, date windows and JSON envelopes are constrained", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), offer = await tx.rewardOffer.create({ data: draftData(f.own) });
      for (const query of ['UPDATE "RewardOffer" SET version=0 WHERE id=$1',
        'UPDATE "RewardOffer" SET "lastRevision"=-1 WHERE id=$1',
        'UPDATE "RewardOffer" SET state=\'PUBLISHED\' WHERE id=$1',
        'UPDATE "RewardOffer" SET "publishedRevision"=1 WHERE id=$1',
        'UPDATE "RewardOffer" SET "updatedAt"=\'infinity\' WHERE id=$1',
        'UPDATE "RewardOffer" SET draft=\'{}\'::jsonb WHERE id=$1',
        'UPDATE "RewardOffer" SET draft=\'[]\'::jsonb WHERE id=$1',
        'UPDATE "RewardOffer" SET draft=\'{"schemaVersion":2}\'::jsonb WHERE id=$1']) await rejectsSql(tx, query, [offer.id]);
      const revision = await tx.rewardOfferRevision.create({ data: { organisationId: f.own.organisation.id, offerId: offer.id, revision: 1,
        terms: offer.draft, actorUserId: f.own.user.id } });
      await tx.rewardOffer.update({ where: { id: offer.id }, data: { state: "PUBLISHED", lastRevision: 1, publishedRevision: 1, publishedStartsAt: NOW, publishedEndsAt: END } });
      await rejectsSql(tx, 'UPDATE "RewardOffer" SET "publishedEndsAt"="publishedStartsAt" WHERE id=$1', [offer.id]);
      await rejectsSql(tx, 'UPDATE "RewardOffer" SET "publishedEndsAt"=\'infinity\' WHERE id=$1', [offer.id]);
      assert.equal(revision.revision, 1);
    }));

    await t.test("published revisions cannot be changed, deleted, cascaded or truncated", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), offer = await tx.rewardOffer.create({ data: draftData(f.own) });
      const revision = await tx.rewardOfferRevision.create({ data: { organisationId: f.own.organisation.id, offerId: offer.id,
        revision: 1, terms: offer.draft, actorUserId: f.own.user.id } });
      await tx.rewardOffer.update({ where: { id: offer.id }, data: { state: "PUBLISHED", lastRevision: 1,
        publishedRevision: 1, publishedStartsAt: NOW, publishedEndsAt: END } });
      await tx.rewardOffer.update({ where: { id: offer.id }, data: { draft: terms([f.own.location.id], "Changed draft") } });
      assert.deepEqual((await tx.rewardOfferRevision.findUnique({ where: { id: revision.id } })).terms, revision.terms);
      await rejectsSql(tx, 'UPDATE "RewardOfferRevision" SET terms=terms WHERE id=$1', [revision.id], "55000");
      await rejectsSql(tx, 'DELETE FROM "RewardOfferRevision" WHERE id=$1', [revision.id], ["55000", "23503", "23001"]);
      // Validate deferred campaign constraints before exercising the immutable guard.
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      await rejectsSql(tx, 'TRUNCATE "RewardOfferRevision" CASCADE', [], "55000");
      await rejectsSql(tx, 'DELETE FROM "RewardOffer" WHERE id=$1', [offer.id], ["23503", "23001"]);
    }));

    await t.test("offer audit preserves typed metadata and rejects sensitive or mismatched target data", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), offer = await tx.rewardOffer.create({ data: draftData(f.own) });
      const data = { organisationId: f.own.organisation.id, actorUserId: f.own.user.id, actorOrganisationMemberId: f.own.member.id,
        action: "OFFER_CREATED", targetType: "OFFER", targetId: offer.id, metadata: { reasonCode: "OWNER_REQUEST", version: 1, revision: 0 } };
      const event = await tx.rewardAuditEvent.create({ data }); assert.deepEqual(event.metadata, data.metadata);
      for (const metadata of [{ version: -1 }, { revision: 0.5 }, { version: "1" }, { revision: null }, { shopperEmail: "synthetic@example.invalid" }])
        await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId",action,"targetType","targetId",metadata) VALUES ($1,$2,\'OFFER_CREATED\',\'OFFER\',$3,$4::jsonb)',
          [`${f.prefix}_${randomUUID()}`, f.own.organisation.id, offer.id, JSON.stringify(metadata)]);
      await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId",action,"targetType","targetId") VALUES ($1,$2,\'OFFER_CREATED\',\'PROGRAM\',$3)',
        [`${f.prefix}_wrongtarget`, f.own.organisation.id, offer.id]);
    }));

    await t.test("existing subscriber reset still works when all Rewards tables are empty", () => syntheticTransaction(db, async tx => {
      const prefix = `rr02_reset_${randomUUID().replaceAll("-", "")}`;
      const actor = await tx.user.create({ data: { email: `${prefix}@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
      const organisation = await tx.organisation.create({ data: { name: "Synthetic reset tenant", slug: prefix } });
      const user = await tx.user.create({ data: { email: `${prefix}-target@example.invalid`, passwordHash: "synthetic" } });
      await tx.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id } });
      for (const delegate of ["rewardProgram", "rewardEntitlementGrant", "rewardStaffGrant", "rewardAuditEvent", "rewardOffer", "rewardOfferRevision", "rewardOfferLocation"])
        assert.equal(await tx[delegate].count(), 0);
      const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION } = await import("../lib/subscriber-test-reset.mjs");
      const result = await resetSubscriberTestData({ $transaction: operation => operation(tx) }, {
        actor, retainedEmail: actor.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION
      });
      assert.ok(result.deletedOrganisations >= 1); assert.ok(result.deletedUsers >= 1);
      assert.equal(await tx.organisation.count(), 0); assert.equal(await tx.user.count(), 1);
      assert.equal((await tx.user.findUnique({ where: { id: actor.id } })).role, "SUPER_ADMIN");
    }));

    await t.test("published revision prevents reset atomically without nulling its pointer", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), offer = await tx.rewardOffer.create({ data: draftData(f.own) });
      const revision = await tx.rewardOfferRevision.create({ data: { organisationId: f.own.organisation.id, offerId: offer.id,
        revision: 1, terms: offer.draft, actorUserId: f.own.user.id } });
      await tx.rewardOffer.update({ where: { id: offer.id }, data: { state: "PUBLISHED", lastRevision: 1,
        publishedRevision: 1, publishedStartsAt: NOW, publishedEndsAt: END } });
      await tx.rewardOfferLocation.createMany({ data: ["DRAFT", "PUBLISHED"].map(scope => ({
        organisationId: f.own.organisation.id, offerId: offer.id, locationId: f.own.location.id, scope })) });
      const actor = await tx.user.create({ data: { email: `${f.prefix}-admin@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
      const delegates = ["organisation", "user", "organisationMember", "rewardProgram", "rewardEntitlementGrant", "rewardOffer", "rewardOfferRevision", "rewardOfferLocation"];
      const before = Object.fromEntries(await Promise.all(delegates.map(async name => [name, await tx[name].findMany()])));
      const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION } = await import("../lib/subscriber-test-reset.mjs");
      const nestedTransaction = async operation => {
        await tx.$executeRawUnsafe("SAVEPOINT offer_reset_atomicity");
        try { const result = await operation(tx); await tx.$executeRawUnsafe("RELEASE SAVEPOINT offer_reset_atomicity"); return result; }
        catch (error) { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT offer_reset_atomicity"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT offer_reset_atomicity"); throw error; }
      };
      await assert.rejects(resetSubscriberTestData({ $transaction: nestedTransaction }, {
        actor, retainedEmail: actor.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION
      }), error => error.code === "RESET_STAGE_REWARDOFFERREVISION");
      for (const name of delegates) assert.deepEqual(await tx[name].findMany(), before[name], `${name} changed after rejected reset.`);
      assert.deepEqual(await tx.rewardOfferRevision.findUnique({ where: { id: revision.id } }), revision);
      assert.equal((await tx.rewardOffer.findUnique({ where: { id: offer.id } })).publishedRevision, 1);
    }));

    const { createRewardOfferService } = await import("../lib/retail-rewards/offer-service.mjs");
    const f = await fixture(db, { activeOffers: 1, locations: 1 });
    const service = createRewardOfferService({ db, env: { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, clock: () => NOW, loadContext: freshContext(db, f.own) });
    const foreignService = createRewardOfferService({ db, env: { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, clock: () => NOW, loadContext: freshContext(db, f.foreign) });

    await t.test("concurrent publish reserves only one slot and keeps revision, targets and audit atomic", async () => {
      const first = await service.create({ terms: terms([f.own.location.id], "First") }); assert.equal(first.ok, true, JSON.stringify(first));
      const second = await service.create({ terms: terms([f.own.location.id], "Second") }); assert.equal(second.ok, true, JSON.stringify(second));
      const results = await Promise.all([first, second].map(result => service.transition(result.offer.id, "PUBLISH", { expectedVersion: result.offer.version })));
      assert.equal(results.filter(row => row.ok).length, 1, JSON.stringify(results));
      assert.equal(results.find(row => !row.ok)?.code, "LIMIT_REACHED", JSON.stringify(results));
      assert.equal(await db.rewardOffer.count({ where: { organisationId: f.own.organisation.id, state: "PUBLISHED" } }), 1);
      assert.equal(await db.rewardOfferRevision.count({ where: { organisationId: f.own.organisation.id } }), 1);
      assert.equal(await db.rewardOfferLocation.count({ where: { organisationId: f.own.organisation.id, scope: "PUBLISHED" } }), 1);
      assert.equal(await db.rewardAuditEvent.count({ where: { organisationId: f.own.organisation.id, action: "OFFER_PUBLISHED" } }), 1);
    });

    await t.test("concurrent draft edits accept one version and preserve the issued revision", async () => {
      const offer = await db.rewardOffer.findFirst({ where: { organisationId: f.own.organisation.id, state: "PUBLISHED" } });
      const snapshot = await db.rewardOfferRevision.findFirst({ where: { offerId: offer.id } });
      const results = await Promise.all(["One edit", "Another edit"].map(title => service.update(offer.id,
        { expectedVersion: offer.version, terms: terms([f.own.location.id], title) })));
      assert.equal(results.filter(row => row.ok).length, 1, JSON.stringify(results));
      assert.equal(results.find(row => !row.ok)?.code, "CONFLICT", JSON.stringify(results));
      assert.deepEqual(await db.rewardOfferRevision.findUnique({ where: { id: snapshot.id } }), snapshot);
      const current = await db.rewardOffer.findUnique({ where: { id: offer.id } });
      assert.equal(current.publishedRevision, offer.publishedRevision); assert.equal(current.state, "PUBLISHED");
    });

    await t.test("JSON title and category filters query only the caller's offers", async () => {
      const ownOffer = await db.rewardOffer.findFirst({ where: { organisationId: f.own.organisation.id, state: "PUBLISHED" } });
      const result = await service.list({ search: ownOffer.draft.title.toLowerCase(), category: "HOME" });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(result.offers.some(row => row.id === ownOffer.id));
      assert.ok(result.offers.every(row => row.draft.category === "HOME"));
      const wrongCategory = await service.list({ search: ownOffer.draft.title, category: "FASHION" });
      assert.equal(wrongCategory.ok, true); assert.equal(wrongCategory.offers.length, 0);
      const foreignResult = await foreignService.list({ search: ownOffer.draft.title });
      assert.equal(foreignResult.ok, true); assert.equal(foreignResult.offers.length, 0);
    });

    await t.test("concurrent publication cannot oversubscribe the unique-location quota", async () => {
      const isolated = await fixture(db, { activeOffers: 2, locations: 1 });
      const extra = await db.location.create({ data: { organisationId: isolated.own.organisation.id,
        name: "Second synthetic location", slug: `${isolated.prefix}-extra`, status: "ACTIVE" } });
      const quotaService = createRewardOfferService({ db, env: { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, clock: () => NOW,
        loadContext: freshContext(db, isolated.own) });
      const drafts = [];
      for (const location of [isolated.own.location, extra]) {
        const result = await quotaService.create({ terms: terms([location.id]) });
        assert.equal(result.ok, true, JSON.stringify(result)); drafts.push(result.offer);
      }
      const results = await Promise.all(drafts.map(offer => quotaService.transition(offer.id, "PUBLISH", { expectedVersion: offer.version })));
      assert.equal(results.filter(row => row.ok).length, 1, JSON.stringify(results));
      assert.equal(results.find(row => !row.ok)?.code, "LIMIT_REACHED", JSON.stringify(results));
      assert.equal(await db.rewardOfferRevision.count({ where: { organisationId: isolated.own.organisation.id } }), 1);
      assert.equal(await db.rewardOfferLocation.count({ where: { organisationId: isolated.own.organisation.id, scope: "PUBLISHED" } }), 1);
      assert.equal(await db.rewardAuditEvent.count({ where: { organisationId: isolated.own.organisation.id, action: "OFFER_PUBLISHED" } }), 1);
    });

    await t.test("foreign IDs and partial staff location access never expose or mutate an offer", async () => {
      const ownOffer = await db.rewardOffer.findFirst({ where: { organisationId: f.own.organisation.id } });
      const denied = await foreignService.update(ownOffer.id, { expectedVersion: ownOffer.version, terms: terms([f.foreign.location.id]) });
      assert.equal(denied.code, "OFFER_UNAVAILABLE");
      const list = await foreignService.list({}); assert.equal(list.ok, true); assert.equal(list.offers.length, 0);
      const extra = await db.location.create({ data: { organisationId: f.own.organisation.id, name: "Second synthetic shop", slug: `${f.prefix}-extra`, status: "ACTIVE" } });
      const multi = await service.create({ terms: terms([f.own.location.id, extra.id], "Two shops") }); assert.equal(multi.ok, true, JSON.stringify(multi));
      await db.organisationMember.update({ where: { id: f.own.member.id }, data: { role: "MANAGER" } });
      await db.rewardStaffGrant.create({ data: { organisationId: f.own.organisation.id, organisationMemberId: f.own.member.id,
        scope: "LOCATIONS", locationId: f.own.location.id, capabilities: ["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS"], startsAt: NOW, expiresAt: END } });
      assert.equal((await service.update(multi.offer.id, { expectedVersion: multi.offer.version, terms: terms([f.own.location.id]) })).code, "OFFER_UNAVAILABLE");
      assert.ok(!(await service.list({})).offers.some(row => row.id === multi.offer.id));
      await db.organisationMember.update({ where: { id: f.own.member.id }, data: { role: "OWNER" } });
    });

    await t.test("authority revoked before the write transaction causes zero writes", async () => {
      const before = { offers: await db.rewardOffer.count(), audit: await db.rewardAuditEvent.count() };
      let revokeOnce = true;
      const wrapped = new Proxy(db, { get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key);
        return async (...args) => {
          if (revokeOnce) { revokeOnce = false; await db.rewardEntitlementGrant.update({ where: { id: f.own.grant.id }, data: { revokedAt: NOW } }); }
          return target.$transaction(...args);
        };
      } });
      const racingService = createRewardOfferService({ db: wrapped, env: { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, clock: () => NOW, loadContext: freshContext(db, f.own) });
      const result = await racingService.create({ terms: terms([f.own.location.id], "Must not save") });
      assert.equal(result.ok, false); assert.equal(result.code, "NOT_ENTITLED");
      assert.equal(await db.rewardOffer.count(), before.offers); assert.equal(await db.rewardAuditEvent.count(), before.audit);
    });

    for (const authority of ["grant", "session", "membership"]) {
      await t.test(`${authority} revocation committed while waiting for the programme lock causes zero writes`, async () => {
        const isolated = await fixture(db);
        const tenant = isolated.own;
        const racingService = createRewardOfferService({ db, env: { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, clock: () => NOW,
          loadContext: freshContext(db, tenant) });
        let release, acquired;
        const held = new Promise(resolve => { acquired = resolve; });
        const releaseGate = new Promise(resolve => { release = resolve; });
        const locker = db.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "RewardProgram" WHERE "id" = ${tenant.program.id} FOR UPDATE`;
          acquired();
          await releaseGate;
        }, { timeout: 15000 });
        let operation, result;
        try {
          await Promise.race([held, locker.then(() => { throw new Error("Programme lock ended before acquisition."); })]);
          operation = racingService.create({ terms: terms([tenant.location.id], "Revoked while queued") });
          const deadline = Date.now() + 3000;
          let waiting = false;
          while (Date.now() < deadline) {
            const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid()
                AND state = 'active' AND wait_event_type = 'Lock'
                AND query LIKE '%FROM "RewardProgram"%' AND query LIKE '%FOR UPDATE%'`;
            if (rows[0].count > 0) { waiting = true; break; }
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(waiting, true, "Offer write never reached the held programme lock.");
          if (authority === "grant") await db.rewardEntitlementGrant.update({ where: { id: tenant.grant.id }, data: { revokedAt: NOW } });
          if (authority === "session") await db.session.update({ where: { id: tenant.session.id }, data: { revokedAt: NOW } });
          if (authority === "membership") await db.organisationMember.update({ where: { id: tenant.member.id }, data: { role: "VIEWER" } });
        } finally {
          release();
          await locker;
          if (operation) result = await operation;
        }
        assert.equal(result?.ok, false, `${authority} revoked before lock release was accepted: ${JSON.stringify(result)}`);
        assert.equal(result.code, { grant: "NOT_ENTITLED", session: "UNAUTHENTICATED", membership: "FORBIDDEN" }[authority]);
        assert.equal(await db.rewardOffer.count({ where: { organisationId: tenant.organisation.id } }), 0);
        assert.equal(await db.rewardAuditEvent.count({ where: { organisationId: tenant.organisation.id } }), 0);
      });
    }
  } finally { await db.$disconnect(); }
});
