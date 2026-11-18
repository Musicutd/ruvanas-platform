import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2027-11-14T12:00:00.000Z");
const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_SHOPPER_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const rollback = new Error("ROLL_BACK_SYNTHETIC_REWARDS_OFFER_FIXTURE");

export function shopperDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_SHOPPER_LOCAL_TEST, undefined);
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
  assert.equal(env.RUVANAS_REWARDS_SHOPPER_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "rr03a_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.ok(["/ruvanas_rewards_shopper_full", "/ruvanas_rewards_shopper_upgrade"].includes(url.pathname));
  assert.equal(url.search, "?connection_limit=6"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr03a-20261114\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

export async function openShopperDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = shopperDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.ok(identity.version >= 160000 && identity.version < 170000);
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "rr03a_qa"); assert.equal(identity.host, "127.0.0.1"); assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });

test("RR-03a database tests reject unowned targets before constructing a database client", async () => {
  assert.equal(shopperDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_SHOPPER_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/unknown" },
    { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_RUN_ID: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openShopperDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openShopperDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) }));
  assert.equal(disconnected, 1);
});

const ENV = Object.freeze({ RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false", SESSION_SECRET: "synthetic-local-shopper-test-secret-not-production" });
const SESSION_START = new Date(NOW.getTime() - 60_000), SESSION_END = new Date(NOW.getTime() + 3_600_000);

async function syntheticTransaction(db, operation) {
  try { await db.$transaction(async tx => { await operation(tx); throw rollback; }, { timeout: 120000 }); assert.fail("Expected fixture rollback."); }
  catch (error) { if (error !== rollback) throw error; }
}
async function rejectsSql(tx, query, params = [], codes = ["23514"]) {
  await tx.$executeRawUnsafe("SAVEPOINT rejected_shopper_write"); let error;
  try { await tx.$executeRawUnsafe(query, ...params); } catch (caught) { error = caught; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rejected_shopper_write");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT rejected_shopper_write");
  assert.ok(error, `Forbidden SQL accepted: ${query}`);
  assert.ok(codes.includes(error.meta?.code), `Unexpected rejection: ${error.message}`);
}
function terms(locationIds, title = "Public Home offer") {
  return { schemaVersion: 1, title, description: "Publicly approved coupon", category: "HOME", type: "PERCENT_OFF",
    percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000,
    exclusions: "Gift cards", legalTerms: "Synthetic public terms.", combinable: false, startsAt: NOW.toISOString(), endsAt: END.toISOString(),
    timezone: "Europe/Malta", locationIds, usage: "REUSABLE", totalLimit: 100, perShopperLimit: 10,
    perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED" };
}
async function shopperFixture(db) {
  const { hashShopperSessionToken } = await import("../lib/retail-rewards/shopper-access.mjs");
  const token = randomBytes(32).toString("hex");
  const shopper = await db.rewardShopper.create({ data: { displayName: "Synthetic shopper", status: "ACTIVE" } });
  const session = await db.rewardShopperSession.create({ data: { shopperId: shopper.id,
    tokenHash: hashShopperSessionToken(token, ENV.SESSION_SECRET), authVersion: shopper.authVersion,
    createdAt: SESSION_START, expiresAt: SESSION_END } });
  const membership = await db.rewardShopperMembership.create({ data: { shopperId: shopper.id, status: "ACTIVE",
    startsAt: new Date("2026-01-01T00:00:00Z"), expiresAt: END } });
  return { shopper, session, membership, token };
}
async function merchantFixture(db) {
  const prefix = `rr03a_${randomUUID().replaceAll("-", "")}`;
  const organisation = await db.organisation.create({ data: { name: "DO_NOT_EXPOSE_PRIVATE_ORG", slug: prefix } });
  const plan = await db.plan.create({ data: { name: `Private client plan ${prefix}`, code: prefix.toUpperCase(), productFamily: "RETAIL", active: true,
    monthlyPriceCents: 1000, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128, retailRadioEnabled: true } });
  const subscription = await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE", currentPeriodEnd: END } });
  const location = await db.location.create({ data: { organisationId: organisation.id, name: "DO_NOT_EXPOSE_PRIVATE_LOCATION", slug: prefix,
    addressLine1: "DO_NOT_EXPOSE_PRIVATE_ADDRESS", city: "PRIVATE_CITY", countryCode: "GB", status: "ACTIVE" } });
  const program = await db.rewardProgram.create({ data: { organisationId: organisation.id, status: "ACTIVE", networkOptIn: true } });
  const grant = await db.rewardEntitlementGrant.create({ data: { organisationId: organisation.id, subscriptionId: subscription.id,
    tier: "REWARDS_STARTER", status: "ACTIVE", startsAt: new Date("2026-01-01T00:00:00Z"), expiresAt: END,
    activeOffers: 10, locations: 10, staffSeats: 3, monthlyRedemptions: 100, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false } });
  const profile = await db.rewardPublicShopProfile.create({ data: { organisationId: organisation.id, locationId: location.id,
    publicSlug: `public-shop-${prefix.slice(-12)}`, displayName: "Public shop", description: "Explicit public description", locality: "Valletta",
    countryCode: "MT", status: "PUBLISHED", networkOptIn: true, publishedAt: SESSION_START } });
  const published = terms([location.id]);
  const offer = await db.rewardOffer.create({ data: { organisationId: organisation.id, programId: program.id,
    draft: { ...published, title: "DO_NOT_EXPOSE_PRIVATE_DRAFT", category: "FASHION" }, createdByUserId: "synthetic-client-admin", updatedByUserId: "synthetic-client-admin" } });
  const revision = await db.rewardOfferRevision.create({ data: { organisationId: organisation.id, offerId: offer.id,
    revision: 1, terms: published, actorUserId: "synthetic-client-admin" } });
  await db.rewardOffer.update({ where: { id: offer.id }, data: { state: "PUBLISHED", lastRevision: 1,
    publishedRevision: 1, publishedStartsAt: NOW, publishedEndsAt: END } });
  await db.rewardOfferLocation.createMany({ data: ["DRAFT", "PUBLISHED"].map(scope => ({
    organisationId: organisation.id, offerId: offer.id, locationId: location.id, scope })) });
  const listing = await db.rewardOfferDiscovery.create({ data: { organisationId: organisation.id, offerId: offer.id, revision: 1,
    publicSlug: `public-offer-${prefix.slice(-12)}`, discoverable: true, approvedAt: SESSION_START } });
  return { prefix, organisation, plan, subscription, location, program, grant, profile, offer, revision, listing, published };
}
async function serviceFor(db, shopper, clock = () => NOW) {
  const { requireRewardShopperAccess } = await import("../lib/retail-rewards/shopper-access.mjs");
  const { createShopperDiscoveryService } = await import("../lib/retail-rewards/shopper-discovery-service.mjs");
  return createShopperDiscoveryService({ db, env: ENV, clock,
    loadShopper: client => requireRewardShopperAccess({ db: client, env: ENV, token: shopper.token, clock }) });
}

test("RR-03a PostgreSQL shopper identity, public discovery and reset isolation", {
  skip: !requested && "Requires an owned disposable RR-03a cluster or the dedicated Rewards CI database."
}, async t => {
  const { db } = await openShopperDatabase(process.env);
  try {
    for (const name of ["rewardShopper", "rewardShopperSession", "rewardShopperMembership", "rewardPublicShopProfile", "rewardOfferDiscovery"])
      assert.equal(await db[name].count(), 0, "Expected no activation/backfill in isolated migration fixture.");

    await t.test("shopper identity has no implicit business account and defaults disabled", () => syntheticTransaction(db, async tx => {
      const before = await Promise.all([tx.user.count(), tx.organisation.count(), tx.organisationMember.count(), tx.subscription.count()]);
      const shopper = await tx.rewardShopper.create({ data: {} });
      const membership = await tx.rewardShopperMembership.create({ data: { shopperId: shopper.id, startsAt: NOW, expiresAt: END } });
      assert.equal(shopper.status, "DISABLED"); assert.equal(shopper.authVersion, 1);
      assert.equal(membership.status, "DISABLED"); assert.equal(membership.source, "MANUAL_INTERNAL");
      assert.deepEqual(await Promise.all([tx.user.count(), tx.organisation.count(), tx.organisationMember.count(), tx.subscription.count()]), before);
      await rejectsSql(tx, 'UPDATE "RewardShopper" SET "authVersion"=0 WHERE id=$1', [shopper.id]);
      await rejectsSql(tx, 'UPDATE "RewardShopper" SET "displayName"=\' \"\' WHERE id=$1', [shopper.id]);
      await rejectsSql(tx, 'UPDATE "RewardShopper" SET "createdAt"=\'infinity\' WHERE id=$1', [shopper.id]);
    }));

    await t.test("session hashes, lifetime, membership dates and deletion boundaries are enforced", () => syntheticTransaction(db, async tx => {
      const f = await shopperFixture(tx);
      for (const query of ['UPDATE "RewardShopperSession" SET "tokenHash"=\'RAW_SECRET\' WHERE id=$1',
        'UPDATE "RewardShopperSession" SET "authVersion"=0 WHERE id=$1',
        'UPDATE "RewardShopperSession" SET "expiresAt"="createdAt" WHERE id=$1',
        'UPDATE "RewardShopperSession" SET "expiresAt"="createdAt"+interval \'24 hours 1 millisecond\' WHERE id=$1',
        'UPDATE "RewardShopperSession" SET "expiresAt"=\'infinity\' WHERE id=$1',
        'UPDATE "RewardShopperSession" SET "revokedAt"="createdAt"-interval \'1 millisecond\' WHERE id=$1']) await rejectsSql(tx, query, [f.session.id]);
      for (const query of ['UPDATE "RewardShopperMembership" SET "source"=\'PAID\' WHERE id=$1',
        'UPDATE "RewardShopperMembership" SET version=0 WHERE id=$1',
        'UPDATE "RewardShopperMembership" SET "expiresAt"="startsAt" WHERE id=$1',
        'UPDATE "RewardShopperMembership" SET "revokedAt"=\'infinity\' WHERE id=$1']) await rejectsSql(tx, query, [f.membership.id]);
      await rejectsSql(tx, 'DELETE FROM "RewardShopper" WHERE id=$1', [f.shopper.id], ["23503", "23001"]);
    }));

    await t.test("public profiles and exact revision listings cannot cross tenant foreign keys", () => syntheticTransaction(db, async tx => {
      const own = await merchantFixture(tx), foreign = await merchantFixture(tx);
      await rejectsSql(tx, 'UPDATE "RewardPublicShopProfile" SET "locationId"=$1 WHERE id=$2', [foreign.location.id, own.profile.id], ["23503", "23505"]);
      await rejectsSql(tx, 'UPDATE "RewardPublicShopProfile" SET "organisationId"=$1 WHERE id=$2', [foreign.organisation.id, own.profile.id], ["23503"]);
      await rejectsSql(tx, 'UPDATE "RewardOfferDiscovery" SET "organisationId"=$1 WHERE id=$2', [foreign.organisation.id, own.listing.id], ["23503"]);
      await rejectsSql(tx, 'UPDATE "RewardOfferDiscovery" SET revision=2 WHERE id=$1', [own.listing.id], ["23503"]);
      await rejectsSql(tx, 'DELETE FROM "Location" WHERE id=$1', [own.location.id], ["23503", "23001"]);
    }));

    await t.test("public text, slug, country and consent timestamps reject malformed values", () => syntheticTransaction(db, async tx => {
      const f = await merchantFixture(tx);
      for (const query of ['UPDATE "RewardPublicShopProfile" SET "publicSlug"=\'internal/path\' WHERE id=$1',
        'UPDATE "RewardPublicShopProfile" SET "publicSlug"=\'ab\' WHERE id=$1',
        'UPDATE "RewardPublicShopProfile" SET "countryCode"=\'mt\' WHERE id=$1',
        'UPDATE "RewardPublicShopProfile" SET "publishedAt"=NULL WHERE id=$1',
        'UPDATE "RewardPublicShopProfile" SET "displayName"=\'\' WHERE id=$1',
        'UPDATE "RewardPublicShopProfile" SET "revokedAt"=\'infinity\' WHERE id=$1']) await rejectsSql(tx, query, [f.profile.id]);
      await rejectsSql(tx, 'UPDATE "RewardOfferDiscovery" SET "approvedAt"=NULL WHERE id=$1', [f.listing.id]);
      await rejectsSql(tx, 'UPDATE "RewardOfferDiscovery" SET revision=0 WHERE id=$1', [f.listing.id]);
      await rejectsSql(tx, 'UPDATE "RewardOfferDiscovery" SET "publicSlug"=\'has_underscore\' WHERE id=$1', [f.listing.id]);
    }));

    await t.test("shopper guard validates fresh identity, session, membership and exact expiry", () => syntheticTransaction(db, async tx => {
      const { requireRewardShopperAccess } = await import("../lib/retail-rewards/shopper-access.mjs");
      const f = await shopperFixture(tx);
      const access = () => requireRewardShopperAccess({ db: tx, env: ENV, token: f.token, clock: () => NOW });
      assert.equal((await access()).ok, true);
      await tx.rewardShopper.update({ where: { id: f.shopper.id }, data: { authVersion: 2 } });
      assert.equal((await access()).code, "UNAUTHENTICATED");
      await tx.rewardShopper.update({ where: { id: f.shopper.id }, data: { authVersion: 1 } });
      await tx.rewardShopperMembership.update({ where: { id: f.membership.id }, data: { revokedAt: NOW } });
      assert.equal((await access()).code, "FORBIDDEN");
      await tx.rewardShopperMembership.update({ where: { id: f.membership.id }, data: { revokedAt: null } });
      await tx.rewardShopperSession.update({ where: { id: f.session.id }, data: { expiresAt: NOW } });
      assert.equal((await access()).code, "UNAUTHENTICATED");
      const unknown = await requireRewardShopperAccess({ db: tx, env: ENV, token: randomBytes(32).toString("hex"), clock: () => NOW });
      assert.equal(unknown.code, "UNAUTHENTICATED");
    }));

    await t.test("category, shop and coupon queries use published terms and redact private records", () => syntheticTransaction(db, async tx => {
      const shopper = await shopperFixture(tx), merchant = await merchantFixture(tx), service = await serviceFor(tx, shopper);
      const home = await service.shops({ category: "HOME", search: "public shop" });
      assert.equal(home.ok, true, JSON.stringify(home)); assert.equal(home.shops.length, 1, JSON.stringify(home));
      assert.equal((await service.shops({ category: "FASHION" })).shops.length, 0);
      assert.equal((await service.shops({ search: "PRIVATE_DRAFT" })).shops.length, 0);
      const shop = await service.shop(merchant.profile.publicSlug, {}), offer = await service.offer(merchant.profile.publicSlug, merchant.listing.publicSlug);
      assert.equal(shop.ok, true, JSON.stringify(shop)); assert.equal(shop.offers.length, 1);
      const searched = await service.shop(merchant.profile.publicSlug, { category: "HOME", search: "PUBLIC HOME" });
      assert.equal(searched.ok, true, JSON.stringify(searched)); assert.equal(searched.offers.length, 1);
      assert.equal((await service.shop(merchant.profile.publicSlug, { search: "PRIVATE_DRAFT" })).offers.length, 0);
      assert.equal(offer.ok, true, JSON.stringify(offer)); assert.equal(offer.offer.terms.title, "Public Home offer");
      const serialized = JSON.stringify([home, shop, offer]);
      for (const forbidden of ["DO_NOT_EXPOSE", "PRIVATE_CITY", "locationIds", "organisationId", "tokenHash", "passwordHash",
        shopper.shopper.id, shopper.session.id, shopper.membership.id, merchant.organisation.id, merchant.location.id,
        merchant.plan.id, merchant.grant.id, merchant.offer.id, merchant.revision.id]) assert.equal(serialized.includes(forbidden), false, forbidden);
    }));

    await t.test("withdrawal, expired eligibility, mismatched revisions and foreign shop paths remain hidden", () => syntheticTransaction(db, async tx => {
      const shopper = await shopperFixture(tx), own = await merchantFixture(tx), foreign = await merchantFixture(tx), service = await serviceFor(tx, shopper);
      const read = () => service.offer(own.profile.publicSlug, own.listing.publicSlug);
      assert.equal((await read()).ok, true);
      assert.equal((await service.offer(own.profile.publicSlug, foreign.listing.publicSlug)).code, "OFFER_UNAVAILABLE");
      await tx.rewardProgram.update({ where: { id: own.program.id }, data: { networkOptIn: false } });
      assert.equal((await read()).code, "OFFER_UNAVAILABLE");
      await tx.rewardProgram.update({ where: { id: own.program.id }, data: { networkOptIn: true } });
      await tx.rewardPublicShopProfile.update({ where: { id: own.profile.id }, data: { revokedAt: NOW } });
      assert.equal((await read()).code, "OFFER_UNAVAILABLE");
      await tx.rewardPublicShopProfile.update({ where: { id: own.profile.id }, data: { revokedAt: null } });
      await tx.rewardEntitlementGrant.update({ where: { id: own.grant.id }, data: { expiresAt: NOW } });
      assert.equal((await read()).code, "OFFER_UNAVAILABLE");
      await tx.rewardEntitlementGrant.update({ where: { id: own.grant.id }, data: { expiresAt: END } });
      await tx.rewardOfferRevision.create({ data: { organisationId: own.organisation.id, offerId: own.offer.id, revision: 2,
        terms: own.published, actorUserId: "synthetic-client-admin" } });
      await tx.rewardOffer.update({ where: { id: own.offer.id }, data: { lastRevision: 2, publishedRevision: 2 } });
      assert.equal((await read()).code, "OFFER_UNAVAILABLE");
      const stale = await service.shops({ category: "HOME" });
      assert.equal(stale.ok, true, JSON.stringify(stale));
      assert.equal(stale.shops.some(shop => shop.slug === own.profile.publicSlug), false);
      assert.equal(stale.shops.some(shop => shop.slug === foreign.profile.publicSlug), true);
      await tx.rewardOfferDiscovery.update({ where: { id: own.listing.id }, data: { revision: 2 } });
      assert.equal((await read()).ok, true);
      assert.equal((await service.shops({ category: "HOME" })).shops.some(shop => shop.slug === own.profile.publicSlug), true);
    }));

    await t.test("public locality/country filtering precedes paging and locations contain only eligible shops", () => syntheticTransaction(db, async tx => {
      const shopper = await shopperFixture(tx), service = await serviceFor(tx, shopper);
      for (let index = 0; index < 26; index++) {
        const merchant = await merchantFixture(tx);
        await tx.rewardPublicShopProfile.update({ where: { id: merchant.profile.id }, data: {
          publicSlug: `aa-town-${String(index).padStart(2, "0")}`, locality: "Valletta" } });
      }
      const chosen = await merchantFixture(tx), sameNameAbroad = await merchantFixture(tx), hidden = await merchantFixture(tx);
      await tx.rewardPublicShopProfile.update({ where: { id: chosen.profile.id }, data: { publicSlug: "zz-selected-town", locality: "Zurrieq" } });
      await tx.rewardPublicShopProfile.update({ where: { id: sameNameAbroad.profile.id }, data: { locality: "Zurrieq", countryCode: "GB" } });
      await tx.rewardPublicShopProfile.update({ where: { id: hidden.profile.id }, data: { locality: "Hidden town" } });
      await tx.rewardProgram.update({ where: { id: hidden.program.id }, data: { networkOptIn: false } });
      const shops = await service.shops({ locality: "zurrieq", countryCode: "MT" });
      assert.equal(shops.ok, true, JSON.stringify(shops));
      assert.deepEqual(shops.shops.map(shop => shop.slug), ["zz-selected-town"]); assert.equal(shops.hasMore, false);
      const first = await service.locations({ countryCode: "MT" });
      assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.hasMore, true);
      assert.deepEqual(first.locations, [{ locality: "Valletta", countryCode: "MT" }]);
      const second = await service.locations({ countryCode: "MT", page: 2 });
      assert.equal(second.hasMore, false); assert.ok(second.locations.some(location => location.locality === "Zurrieq"));
      assert.deepEqual((await service.locations({ search: "zurr", countryCode: "MT" })).locations, [{ locality: "Zurrieq", countryCode: "MT" }]);
      assert.deepEqual((await service.locations({ search: "Hidden" })).locations, []);
      const payload = JSON.stringify([first, second, shops]);
      for (const secret of [shopper.shopper.id, chosen.organisation.id, chosen.location.id, "PRIVATE_CITY", "organisationId", "locationId"])
        assert.equal(payload.includes(secret), false, secret);
    }));

    await t.test("uses left counts owned net redemptions across revisions, not claims or other shoppers", () => syntheticTransaction(db, async tx => {
      const shopper = await shopperFixture(tx), other = await shopperFixture(tx), merchant = await merchantFixture(tx), foreign = await merchantFixture(tx);
      const service = await serviceFor(tx, shopper), read = () => service.offer(merchant.profile.publicSlug, merchant.listing.publicSlug);
      async function issue(target = merchant, owner = shopper, revision = 1) {
        await tx.rewardOfferUsagePolicy.upsert({ where: { offerId: target.offer.id },
          create: { offerId: target.offer.id, organisationId: target.organisation.id, timezone: "Europe/Malta" }, update: {} });
        return tx.rewardClaim.create({ data: { organisationId: target.organisation.id, offerId: target.offer.id, revision,
          shopperId: owner.shopper.id, shopperAuthVersion: 1, locationId: target.location.id,
          publicShopName: target.profile.displayName, publicShopSlug: target.profile.publicSlug,
          createdAt: NOW, expiresAt: new Date(NOW.getTime() + 3600000) } });
      }
      async function redeem(claim) {
        return tx.rewardRedemption.create({ data: { organisationId: claim.organisationId, offerId: claim.offerId,
          shopperId: claim.shopperId, locationId: claim.locationId, claimId: claim.id,
          actorUserId: "synthetic-client-admin", actorOrganisationMemberId: "synthetic-cashier",
          idempotencyKeyHash: randomBytes(32).toString("hex"), requestHash: randomBytes(32).toString("hex"),
          eligibleSpendMinor: 5000, currency: "EUR", discountMinor: 500, occurredAt: NOW } });
      }
      await issue(); await issue();
      assert.equal((await read()).offer.usage.remaining, 10);
      const receipt = await redeem(await issue()); await redeem(await issue());
      await redeem(await issue(merchant, other)); await redeem(await issue(foreign));
      await tx.rewardOfferRevision.create({ data: { organisationId: merchant.organisation.id, offerId: merchant.offer.id,
        revision: 2, terms: merchant.published, actorUserId: "synthetic-client-admin" } });
      await tx.rewardOffer.update({ where: { id: merchant.offer.id }, data: { lastRevision: 2, publishedRevision: 2 } });
      await tx.rewardOfferDiscovery.update({ where: { id: merchant.listing.id }, data: { revision: 2 } });
      await redeem(await issue(merchant, shopper, 2));
      const result = await read();
      assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.offer.revision, 2);
      assert.deepEqual(result.offer.usage, { limit: 10, used: 3, remaining: 7, asOf: NOW.toISOString() });
      await tx.rewardRedemptionReversal.create({ data: { organisationId: merchant.organisation.id, redemptionId: receipt.id,
        actorUserId: "synthetic-client-admin", actorOrganisationMemberId: "synthetic-cashier", reason: "WRONG_COUPON",
        idempotencyKeyHash: randomBytes(32).toString("hex"), requestHash: randomBytes(32).toString("hex"), occurredAt: NOW } });
      assert.deepEqual((await read()).offer.usage, { limit: 10, used: 2, remaining: 8, asOf: NOW.toISOString() });
      const serialized = JSON.stringify(result);
      for (const privateValue of [shopper.shopper.id, other.shopper.id, receipt.id, merchant.organisation.id, merchant.offer.id])
        assert.equal(serialized.includes(privateValue), false);
    }));

    await t.test("26 stale revisions cannot fill the first shop or coupon candidate page", () => syntheticTransaction(db, async tx => {
      const shopper = await shopperFixture(tx), merchant = await merchantFixture(tx), service = await serviceFor(tx, shopper);
      const shopSlug = "zz-current-shop", offerSlug = "zz-current-coupon";
      await tx.rewardPublicShopProfile.update({ where: { id: merchant.profile.id }, data: { publicSlug: shopSlug } });
      await tx.rewardOfferDiscovery.update({ where: { id: merchant.listing.id }, data: { publicSlug: offerSlug } });
      for (let index = 0; index < 26; index++) {
        const suffix = String(index).padStart(2, "0"), slug = `aa-stale-${suffix}`;
        const location = await tx.location.create({ data: { organisationId: merchant.organisation.id,
          name: "Private stale offer location", slug, status: "ACTIVE" } });
        await tx.rewardPublicShopProfile.create({ data: { organisationId: merchant.organisation.id, locationId: location.id,
          publicSlug: `${slug}-shop`, displayName: "Public stale-revision shop", description: "Explicit public profile",
          locality: "Valletta", countryCode: "MT", status: "PUBLISHED", networkOptIn: true, publishedAt: SESSION_START } });
        const published = terms([merchant.location.id, location.id]);
        const offer = await tx.rewardOffer.create({ data: { organisationId: merchant.organisation.id,
          programId: merchant.program.id, draft: published, createdByUserId: "synthetic-client-admin", updatedByUserId: "synthetic-client-admin" } });
        await tx.rewardOfferRevision.createMany({ data: [1, 2].map(revision => ({ organisationId: merchant.organisation.id,
          offerId: offer.id, revision, terms: published, actorUserId: "synthetic-client-admin" })) });
        await tx.rewardOffer.update({ where: { id: offer.id }, data: { state: "PUBLISHED", lastRevision: 2,
          publishedRevision: 2, publishedStartsAt: NOW, publishedEndsAt: END } });
        await tx.rewardOfferLocation.createMany({ data: ["DRAFT", "PUBLISHED"].flatMap(scope => [merchant.location.id, location.id]
          .map(locationId => ({ organisationId: merchant.organisation.id, offerId: offer.id, locationId, scope }))) });
        await tx.rewardOfferDiscovery.create({ data: { organisationId: merchant.organisation.id, offerId: offer.id,
          revision: 1, publicSlug: `${slug}-coupon`, discoverable: true, approvedAt: SESSION_START } });
      }
      const shops = await service.shops({ category: "HOME" });
      assert.equal(shops.ok, true, JSON.stringify(shops));
      assert.deepEqual(shops.shops.map(shop => shop.slug), [shopSlug]); assert.equal(shops.hasMore, false);
      const shop = await service.shop(shopSlug, { category: "HOME", search: "PUBLIC HOME" });
      assert.equal(shop.ok, true, JSON.stringify(shop));
      assert.deepEqual(shop.offers.map(offer => offer.slug), [offerSlug]); assert.equal(shop.hasMore, false);
    }));

    await t.test("business subscriber reset preserves global shoppers, sessions and memberships", () => syntheticTransaction(db, async tx => {
      const shopper = await shopperFixture(tx);
      const actor = await tx.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
      const organisation = await tx.organisation.create({ data: { name: "Synthetic reset-only client", slug: `reset-${randomUUID()}` } });
      const user = await tx.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic" } });
      await tx.organisationMember.create({ data: { userId: user.id, organisationId: organisation.id } });
      const before = await Promise.all([tx.rewardShopper.findMany(), tx.rewardShopperSession.findMany(), tx.rewardShopperMembership.findMany()]);
      const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION, ORGANISATION_SCOPED_RESET_MODELS } = await import("../lib/subscriber-test-reset.mjs");
      const names = ORGANISATION_SCOPED_RESET_MODELS.map(row => row.modelName);
      for (const model of ["RewardShopper", "RewardShopperSession", "RewardShopperMembership"]) assert.equal(names.includes(model), false);
      assert.ok(names.indexOf("RewardPublicShopProfile") < names.indexOf("Location"));
      assert.ok(names.indexOf("RewardOfferDiscovery") < names.indexOf("RewardOfferRevision"));
      const result = await resetSubscriberTestData({ $transaction: operation => operation(tx) }, { actor, retainedEmail: actor.email,
        confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION });
      assert.ok(result.deletedOrganisations >= 1); assert.equal(await tx.organisation.count(), 0); assert.equal(await tx.user.count(), 1);
      assert.deepEqual(await Promise.all([tx.rewardShopper.findMany(), tx.rewardShopperSession.findMany(), tx.rewardShopperMembership.findMany()]), before);
      assert.ok(await tx.rewardShopper.findUnique({ where: { id: shopper.shopper.id } }));
    }));
  } finally { await db.$disconnect(); }
});

