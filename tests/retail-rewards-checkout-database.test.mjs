import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2027-11-14T12:00:00.000Z");
const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_CHECKOUT_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const rollback = new Error("ROLL_BACK_SYNTHETIC_REWARDS_OFFER_FIXTURE");

export function checkoutDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_CHECKOUT_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined);
    assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
      GITHUB_JOB: "rewards-checkout-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
    assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.equal(env.DATABASE_URL, CI_URL); assert.equal(env.RUVANAS_REWARDS_DATABASE_URL, CI_URL);
    return { mode: "CI", url: new URL(CI_URL) };
  }
  assert.equal(env.RUVANAS_REWARDS_CHECKOUT_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "rr03c_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.ok(["/ruvanas_rewards_checkout_full", "/ruvanas_rewards_checkout_upgrade"].includes(url.pathname));
  assert.equal(url.search, "?connection_limit=6"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr03c-20261114\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

export async function openCheckoutDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = checkoutDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.ok(identity.version >= 160000 && identity.version < 170000);
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "rr03c_qa"); assert.equal(identity.host, "127.0.0.1"); assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-checkout-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });

test("RR-03c database tests reject unowned targets before constructing a database client", async () => {
  assert.equal(checkoutDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_CHECKOUT_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/unknown" },
    { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_RUN_ID: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openCheckoutDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openCheckoutDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) }));
  assert.equal(disconnected, 1);
});


const ENV = Object.freeze({ RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false",
  SESSION_SECRET: "synthetic-local-checkout-test-secret-not-production" });
const hour = 3_600_000, day = 24 * hour;
const ok = result => { assert.equal(result?.ok, true, `Expected success: ${JSON.stringify(result)}`); return result; };
const denied = (result, codes) => { assert.equal(result?.ok, false, "Unexpected authorization or quota success"); if (codes) assert.ok([codes].flat().includes(result.code), `Unexpected safe denial: ${JSON.stringify(result)}`); return result; };
function terms(locationIds, patch = {}) {
  return { schemaVersion: 1, title: "Synthetic 10 percent coupon", description: "Synthetic public coupon", category: "HOME", type: "PERCENT_OFF",
    percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000,
    exclusions: "Gift cards", legalTerms: "Synthetic terms only", combinable: false,
    startsAt: "2026-01-01T00:00:00.000Z", endsAt: END.toISOString(), timezone: "Europe/Malta", locationIds,
    usage: "REUSABLE", totalLimit: 100, perShopperLimit: 10, perShopperDailyLimit: 10, pausedClaimsPolicy: "HONOUR_ISSUED", ...patch };
}
async function shopperFixture(db, now = NOW, patch = {}) {
  const { hashShopperSessionToken } = await import("../lib/retail-rewards/shopper-access.mjs");
  const shopper = await db.rewardShopper.create({ data: { status: "ACTIVE", displayName: "Synthetic checkout shopper" } });
  const membership = await db.rewardShopperMembership.create({ data: { shopperId: shopper.id, status: "ACTIVE",
    startsAt: new Date("2026-01-01T00:00:00Z"), expiresAt: END, ...patch.membership } });
  const token = randomBytes(32).toString("hex");
  const session = await db.rewardShopperSession.create({ data: { shopperId: shopper.id, authVersion: 1,
    tokenHash: hashShopperSessionToken(token, ENV.SESSION_SECRET), createdAt: new Date(now.getTime()-60_000), expiresAt: new Date(now.getTime()+day-60_000) } });
  return { shopper, membership, session, token };
}
async function newOffer(db, f, patch = {}) {
  const value = terms([f.location.id], patch);
  const offer = await db.rewardOffer.create({ data: { organisationId: f.organisation.id, programId: f.program.id, draft: value,
    createdByUserId: f.user.id, updatedByUserId: f.user.id } });
  await db.rewardOfferRevision.create({ data: { organisationId: f.organisation.id, offerId: offer.id, revision: 1, terms: value, actorUserId: f.user.id } });
  await db.rewardOffer.update({ where: { id: offer.id }, data: { state: "PUBLISHED", lastRevision: 1, publishedRevision: 1,
    publishedStartsAt: new Date(value.startsAt), publishedEndsAt: new Date(value.endsAt) } });
  await db.rewardOfferLocation.createMany({ data: ["DRAFT", "PUBLISHED"].map(scope => ({ organisationId: f.organisation.id, offerId: offer.id, locationId: f.location.id, scope })) });
  const listing = await db.rewardOfferDiscovery.create({ data: { organisationId: f.organisation.id, offerId: offer.id,
    revision: 1, publicSlug: `offer-${randomUUID()}`, discoverable: true, approvedAt: new Date("2026-01-01") } });
  return { offer, listing, terms: value };
}
async function fixture(db, { now = NOW, offerTerms = {}, monthlyRedemptions = 100 } = {}) {
  const prefix = `rr03c_${randomUUID().replaceAll("-", "")}`;
  const organisation = await db.organisation.create({ data: { name: "PRIVATE merchant name", slug: prefix } });
  const plan = await db.plan.create({ data: { name: prefix, code: prefix.toUpperCase(), productFamily: "RETAIL", active: true,
    monthlyPriceCents: 1000, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128, retailRadioEnabled: true } });
  const user = await db.user.create({ data: { email: `${prefix}@example.invalid`, passwordHash: "synthetic-not-password", role: "OWNER" } });
  const member = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role: "OWNER" } });
  const subscription = await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE", currentPeriodEnd: END } });
  const location = await db.location.create({ data: { organisationId: organisation.id, name: "PRIVATE internal shop", slug: "shop", status: "ACTIVE", addressLine1: "PRIVATE address" } });
  const program = await db.rewardProgram.create({ data: { organisationId: organisation.id, status: "ACTIVE", networkOptIn: true } });
  const grant = await db.rewardEntitlementGrant.create({ data: { organisationId: organisation.id, subscriptionId: subscription.id,
    tier: "REWARDS_STARTER", status: "ACTIVE", startsAt: new Date("2026-01-01"), expiresAt: END, activeOffers: 20, locations: 10,
    staffSeats: 10, monthlyRedemptions, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false } });
  const session = await db.session.create({ data: { userId: user.id, activeOrganisationId: organisation.id,
    tokenHash: `${prefix}-synthetic-business-hash`, expiresAt: END, authMethod: "PASSWORD" } });
  const profile = await db.rewardPublicShopProfile.create({ data: { organisationId: organisation.id, locationId: location.id,
    publicSlug: `shop-${randomUUID()}`, displayName: "Public synthetic shop", description: "Deliberately public profile", locality: "Malta", countryCode: "MT",
    status: "PUBLISHED", networkOptIn: true, publishedAt: new Date("2026-01-01") } });
  const f = { prefix, organisation, plan, user, member, subscription, location, program, grant, session, profile };
  return { ...f, ...await newOffer(db, f, offerTerms), shopper: await shopperFixture(db, now) };
}
function freshContext(db, f) {
  return async (tx = db) => {
    const session = await tx.session.findUnique({ where: { id: f.session.id } });
    const user = await tx.user.findUnique({ where: { id: f.user.id }, include: { privatePreviewAccess: true } });
    const memberships = await tx.organisationMember.findMany({ where: { userId: f.user.id },
      include: { organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } } } });
    return { session, user, memberships, membership: memberships.find(row => row.organisationId === session?.activeOrganisationId) || null };
  };
}
async function serviceFor(db, f, shopper = f.shopper, clock = () => NOW, options = {}) {
  const { requireRewardShopperAccess } = await import("../lib/retail-rewards/shopper-access.mjs");
  const { createRewardCheckoutService } = await import("../lib/retail-rewards/checkout-service.mjs");
  return createRewardCheckoutService({ db, env: ENV, clock,
    loadShopper: tx => requireRewardShopperAccess({ db: tx, env: ENV, token: shopper.token, clock }), loadContext: freshContext(db, f), ...options });
}
const claimInput = (f, patch = {}) => ({ shopSlug: f.profile.publicSlug, offerSlug: f.listing.publicSlug, expectedRevision: 1, idempotencyKey: randomUUID(), ...patch });
const redeemInput = (f, code, patch = {}) => ({ token: code.token, locationId: f.location.id,
  idempotencyKey: randomUUID(), eligibleSpendMinor: 5000, currency: "EUR", termsConfirmed: true, ...patch });
async function issued(service, f, input = claimInput(f)) {
  const claim = ok(await service.claim(input)).claim;
  return { claim, code: ok(await service.credential(claim.id)) };
}
async function publishRevision(db, f, patch = {}) {
  const current = await db.rewardOffer.findUnique({ where: { id: f.offer.id } }), revision = current.lastRevision + 1;
  const value = { ...f.terms, ...patch };
  await db.rewardOfferRevision.create({ data: { organisationId: f.organisation.id, offerId: f.offer.id, revision, terms: value, actorUserId: f.user.id } });
  await db.rewardOffer.update({ where: { id: f.offer.id }, data: { draft: value, version: { increment: 1 }, lastRevision: revision,
    publishedRevision: revision, publishedStartsAt: new Date(value.startsAt), publishedEndsAt: new Date(value.endsAt) } });
  await db.rewardOfferDiscovery.update({ where: { offerId: f.offer.id }, data: { revision } });
  return revision;
}
async function syntheticTransaction(db, operation) {
  try { await db.$transaction(async tx => { await operation(tx); throw rollback; }, { timeout: 120000 }); assert.fail("Expected synthetic rollback"); }
  catch (error) { if (error !== rollback) throw error; }
}
async function rejectsSql(tx, query, params = [], codes = ["23514"]) {
  await tx.$executeRawUnsafe("SAVEPOINT rejected_checkout_write"); let error;
  try { await tx.$executeRawUnsafe(query, ...params); } catch (caught) { error = caught; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rejected_checkout_write");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT rejected_checkout_write");
  assert.ok(error, "Forbidden checkout SQL accepted"); assert.ok(codes.includes(error.meta?.code), `Unexpected SQL rejection ${error.meta?.code}`);
}
async function rawClaim(db, f, { shopper = f.shopper, revision = 1, createdAt = NOW, expiresAt = new Date(createdAt.getTime()+hour), locationId = f.location.id } = {}) {
  await db.rewardOfferUsagePolicy.upsert({ where: { offerId: f.offer.id }, create: { offerId: f.offer.id, organisationId: f.organisation.id, timezone: "Europe/Malta" }, update: {} });
  return db.rewardClaim.create({ data: { organisationId: f.organisation.id, offerId: f.offer.id, revision, shopperId: shopper.shopper.id,
    shopperAuthVersion: 1, locationId, publicShopName: f.profile.displayName, publicShopSlug: f.profile.publicSlug, createdAt, expiresAt } });
}
async function rawReceipt(db, f, claim, occurredAt = NOW) {
  return db.rewardRedemption.create({ data: { organisationId: f.organisation.id, offerId: f.offer.id, shopperId: claim.shopperId,
    locationId: claim.locationId, claimId: claim.id, actorUserId: f.user.id, actorOrganisationMemberId: f.member.id,
    idempotencyKeyHash: randomBytes(32).toString("hex"), requestHash: randomBytes(32).toString("hex"),
    eligibleSpendMinor: 5000, currency: "EUR", discountMinor: 500, occurredAt } });
}
async function waitingOnProgram(db, programId, operation, revoke) {
  let release, held;
  const barrier = new Promise(resolve => { held = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const blocker = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "RewardProgram" WHERE id=${programId} FOR UPDATE`; held(); await gate;
  }, { timeout: 30000 });
  await barrier; let pending;
  try {
    pending = operation(); const deadline = Date.now()+10000;
    while (true) {
      const rows = await db.$queryRawUnsafe("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%RewardProgram%FOR UPDATE%'");
      if (rows[0].waiting > 0) break;
      assert.ok(Date.now() < deadline, "Operation never actually waited on the programme lock");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await revoke();
  } finally { release(); await blocker; }
  return pending;
}

test("RR-03c PostgreSQL checkout, atomic receipts, pinned limits and authority races", {
  skip: !requested && "Requires an owned disposable RR-03c cluster or dedicated checkout CI PostgreSQL."
}, async t => {
  const { db } = await openCheckoutDatabase(process.env);
  try {
    for (const model of ["rewardOfferUsagePolicy", "rewardClaim", "rewardClaimRequest", "rewardClaimToken", "rewardRedemption"])
      assert.equal(await db[model].count(), 0, "Only a fresh isolated checkout database may enter this suite");

    await t.test("normal business reset preserves all global shopper identity and authentication rows", () => syntheticTransaction(db, async tx => {
      const s = await shopperFixture(tx), prefix = `rr03c_reset_${randomUUID()}`;
      await tx.rewardShopperCredential.create({ data: { shopperId: s.shopper.id, emailCanonical: `${prefix}@example.invalid`, passwordHash: '$2b$12$'+'a'.repeat(53) } });
      await tx.rewardShopperInvitation.create({ data: { shopperId: s.shopper.id, emailCanonical: `${prefix}@example.invalid`, tokenHash: randomBytes(32).toString('hex'),
        authVersion: 1, createdAt: NOW, expiresAt: new Date(NOW.getTime()+hour) } });
      const actor = await tx.user.create({ data: { email: `${prefix}-owner@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
      const globals = ["rewardShopper", "rewardShopperMembership", "rewardShopperSession", "rewardShopperCredential", "rewardShopperInvitation"];
      const before = await Promise.all(globals.map(name => tx[name].findMany({ orderBy: { createdAt: "asc" } })));
      const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION } = await import("../lib/subscriber-test-reset.mjs");
      await resetSubscriberTestData({ $transaction: operation => operation(tx) }, { actor, retainedEmail: actor.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION });
      const after = await Promise.all(globals.map(name => tx[name].findMany({ orderBy: { createdAt: "asc" } })));
      assert.deepEqual(after, before); assert.equal(await tx.organisation.count(), 0);
    }));

    await t.test("same-tenant revision, location, policy and exact receipt scope foreign keys", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), foreign = await fixture(tx), claim = await rawClaim(tx, f);
      await rejectsSql(tx, 'INSERT INTO "RewardOfferUsagePolicy" ("offerId","organisationId",timezone) VALUES ($1,$2,\'Europe/Malta\')', [foreign.offer.id,f.organisation.id], ["23503"]);
      const insert = 'INSERT INTO "RewardClaim" (id,"organisationId","offerId",revision,"shopperId","shopperAuthVersion","locationId","publicShopName","publicShopSlug","createdAt","expiresAt") VALUES ($1,$2,$3,$4,$5,1,$6,\'Public\',\'public-shop\',$7,$8)';
      for (const [org, offer, rev, loc] of [[f.organisation.id,f.offer.id,2,f.location.id],[foreign.organisation.id,f.offer.id,1,f.location.id],[f.organisation.id,f.offer.id,1,foreign.location.id]])
        await rejectsSql(tx, insert,[randomUUID(),org,offer,rev,f.shopper.shopper.id,loc,NOW,new Date(NOW.getTime()+hour)],["23503"]);
      const receipt = 'INSERT INTO "RewardRedemption" (id,"organisationId","offerId","shopperId","locationId","claimId","actorUserId","actorOrganisationMemberId","idempotencyKeyHash","requestHash","eligibleSpendMinor",currency,"occurredAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,5000,\'EUR\',$11)';
      for (const [org, offer, shopper, loc] of [[foreign.organisation.id,f.offer.id,claim.shopperId,claim.locationId],[f.organisation.id,foreign.offer.id,claim.shopperId,claim.locationId],
        [f.organisation.id,f.offer.id,foreign.shopper.shopper.id,claim.locationId],[f.organisation.id,f.offer.id,claim.shopperId,foreign.location.id]])
        await rejectsSql(tx, receipt,[randomUUID(),org,offer,shopper,loc,claim.id,f.user.id,f.member.id,'a'.repeat(64),'b'.repeat(64),NOW],["23503"]);
      await rejectsSql(tx,'INSERT INTO "RewardClaimRequest" (id,"shopperId","claimId","idempotencyKeyHash","requestHash") VALUES ($1,$2,$3,$4,$5)',
        [randomUUID(),foreign.shopper.shopper.id,claim.id,'a'.repeat(64),'b'.repeat(64)],["23503"]);
      await rejectsSql(tx,'DELETE FROM "RewardShopper" WHERE id=$1',[claim.shopperId],["23503","23001"]);
    }));

    await t.test("finite claim/token lifetimes, positive versions, hash-only keys and bounded receipt amounts", () => syntheticTransaction(db, async tx => {
      const f=await fixture(tx), claim=await rawClaim(tx,f);
      const insert='INSERT INTO "RewardClaimToken" ("claimId","tokenHash","createdAt","expiresAt") VALUES ($1,$2,$3::timestamptz,$4::timestamptz)';
      for(const [hash,start,end] of [['raw-token',NOW,new Date(NOW.getTime()+1000)],['a'.repeat(64),NOW,NOW],['a'.repeat(64),NOW,new Date(NOW.getTime()+300001)],['a'.repeat(64),'2026-11-14','infinity']])
        await rejectsSql(tx,insert,[claim.id,hash,start,end]);
      const claimInsert='INSERT INTO "RewardClaim" (id,"organisationId","offerId",revision,"shopperId","shopperAuthVersion","locationId","publicShopName","publicShopSlug","createdAt","expiresAt") VALUES ($1,$2,$3,1,$4,$5,$6,\'Public\',\'public-shop\',$7::timestamptz,$8::timestamptz)';
      for(const [version,start,end] of [[0,NOW,new Date(NOW.getTime()+hour)],[1,NOW,NOW],[1,NOW,new Date(NOW.getTime()+day+1)],[1,NOW,'infinity']])
        await rejectsSql(tx,claimInsert,[randomUUID(),f.organisation.id,f.offer.id,claim.shopperId,version,claim.locationId,start,end]);
      const receipt=await rawReceipt(tx,f,claim);
      await rejectsSql(tx,'INSERT INTO "RewardRedemption" SELECT $1,"organisationId","offerId","shopperId","locationId","claimId","actorUserId","actorOrganisationMemberId","idempotencyKeyHash","requestHash",-1,currency,"discountMinor","occurredAt" FROM "RewardRedemption" WHERE id=$2',[randomUUID(),receipt.id],["23514","23505"]);
    }));

    await t.test("claim, request, usage policy and redemption evidence reject update/delete/truncate", () => syntheticTransaction(db, async tx => {
      const f=await fixture(tx),claim=await rawClaim(tx,f),receipt=await rawReceipt(tx,f,claim);
      await tx.rewardClaimRequest.create({data:{shopperId:claim.shopperId,claimId:claim.id,idempotencyKeyHash:'a'.repeat(64),requestHash:'b'.repeat(64)}});
      for(const table of ['RewardOfferUsagePolicy','RewardClaim','RewardClaimRequest','RewardRedemption']) {
        await rejectsSql(tx,`UPDATE "${table}" SET ${table==='RewardOfferUsagePolicy'?'timezone=timezone':table==='RewardRedemption'?'"occurredAt"="occurredAt"':'"createdAt"="createdAt"'}`,[],['55000']);
        await rejectsSql(tx,`DELETE FROM "${table}"`,[],['55000','23503','23001']);
        await rejectsSql(tx,`TRUNCATE "${table}" CASCADE`,[],['55000']);
      }
      await tx.rewardClaimToken.create({data:{claimId:claim.id,tokenHash:'c'.repeat(64),createdAt:NOW,expiresAt:new Date(NOW.getTime()+300000)}});
      await tx.rewardClaimToken.update({where:{claimId:claim.id},data:{tokenHash:'d'.repeat(64)}});
      assert.equal((await tx.rewardRedemption.findUnique({where:{id:receipt.id}})).claimId,claim.id);
    }));

    await t.test("claim idempotency, duplicate reuse, public DTO and hash-only storage", async () => {
      const f=await fixture(db),s=await serviceFor(db,f),input=claimInput(f),first=ok(await s.claim(input));
      assert.equal(ok(await s.claim(input)).claim.id,first.claim.id);
      assert.equal(ok(await s.claim(claimInput(f))).claim.id,first.claim.id);
      denied(await s.claim({...input,expectedRevision:2}),'CONFLICT');
      assert.equal(await db.rewardClaim.count({where:{offerId:f.offer.id}}),1);
      assert.equal(await db.rewardClaimRequest.count({where:{shopperId:f.shopper.shopper.id}}),2);
      const wire=JSON.stringify(first);
      for(const privateValue of [f.organisation.id,f.shopper.shopper.id,f.user.id,f.location.id,'PRIVATE address','PRIVATE merchant']) assert.ok(!wire.includes(privateValue));
      const code=ok(await s.credential(first.claim.id)), stored=await db.rewardClaimToken.findUnique({where:{claimId:first.claim.id}});
      assert.notEqual(code.token,stored.tokenHash);assert.match(stored.tokenHash,/^[a-f0-9]{64}$/);
      const {hashRewardCheckoutToken}=await import('../lib/retail-rewards/checkout-service.mjs');
      assert.equal(stored.tokenHash,hashRewardCheckoutToken(code.token,ENV.SESSION_SECRET));
      assert.deepEqual(Object.keys(ok(await s.wallet({}))).sort(),['claims','hasMore','ok','page']);
    });

    await t.test("concurrent duplicate claims and credentials keep one active claim and one latest code", async () => {
      const f=await fixture(db),s=await serviceFor(db,f),input=claimInput(f);
      const results=await Promise.all([s.claim(input),s.claim(input),s.claim(claimInput(f))]);results.forEach(ok);
      assert.equal(new Set(results.map(r=>r.claim.id)).size,1);
      const id=results[0].claim.id,a=ok(await s.credential(id)),b=ok(await s.credential(id));assert.notEqual(a.token,b.token);
      denied(await s.validate({token:a.token,locationId:f.location.id}),'CLAIM_UNAVAILABLE');ok(await s.validate({token:b.token,locationId:f.location.id}));
      assert.equal(await db.rewardClaimToken.count({where:{claimId:id}}),1);
    });

    await t.test("staff review is read-only; exact receipt retry survives expired code without a second redemption", async () => {
      const f=await fixture(db),s=await serviceFor(db,f),{claim,code}=await issued(s,f);
      ok(await s.validate({token:code.token,locationId:f.location.id}));assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),0);
      const input=redeemInput(f,code,{eligibleSpendMinor:5009}),a=ok(await s.redeem(input));assert.equal(a.receipt.discountMinor,500);
      assert.deepEqual(ok(await s.redeem(input)).receipt,a.receipt);
      const later=await serviceFor(db,f,f.shopper,()=>new Date(NOW.getTime()+360000));assert.deepEqual(ok(await later.redeem(input)).receipt,a.receipt);
      denied(await s.redeem({...input,eligibleSpendMinor:6000}),'CONFLICT');denied(await s.redeem({...input,idempotencyKey:randomUUID()}),'ALREADY_REDEEMED');
      assert.equal(await db.rewardRedemption.count({where:{claimId:claim.id}}),1);
    });

    await t.test("concurrent same claim with same and different keys consumes exactly once", async () => {
      const f=await fixture(db),s=await serviceFor(db,f),{code}=await issued(s,f),input=redeemInput(f,code);
      const results=await Promise.all([s.redeem(input),s.redeem(input),s.redeem({...input,idempotencyKey:randomUUID()})]);
      assert.ok(results.some(r=>r.ok));assert.equal(new Set(results.filter(r=>r.ok).map(r=>r.receipt.id)).size,1);
      results.filter(r=>!r.ok).forEach(r=>denied(r,'ALREADY_REDEEMED'));
      assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),1);
    });

    await t.test("wrong tenant, wrong location and another shopper cannot use claim identifiers or codes", async () => {
      const f=await fixture(db),foreign=await fixture(db),s=await serviceFor(db,f),other=await serviceFor(db,foreign),{claim,code}=await issued(s,f);
      denied(await other.validate({token:code.token,locationId:foreign.location.id}),'CLAIM_UNAVAILABLE');
      denied(await other.redeem(redeemInput(foreign,code)),'CLAIM_UNAVAILABLE');denied(await other.credential(claim.id),'CLAIM_UNAVAILABLE');
      assert.equal(ok(await other.wallet({})).claims.length,0);
      const otherLocation=await db.location.create({data:{organisationId:f.organisation.id,name:'Other private shop',slug:'other',status:'ACTIVE'}});
      denied(await s.validate({token:code.token,locationId:otherLocation.id}),'CLAIM_UNAVAILABLE');
      denied(await s.redeem(redeemInput(f,code,{locationId:otherLocation.id})),'CLAIM_UNAVAILABLE');
      assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),0);
    });

    await t.test("expiry and purchase checks enforce finite minimum, currency and terms confirmation", async () => {
      const f=await fixture(db),s=await serviceFor(db,f),{claim,code}=await issued(s,f);
      for(const patch of [{eligibleSpendMinor:4999},{currency:'USD'},{termsConfirmed:false},{eligibleSpendMinor:5000.5}]) denied(await s.redeem(redeemInput(f,code,patch)),'INVALID_REQUEST');
      const later=await serviceFor(db,f,f.shopper,()=>new Date(NOW.getTime()+300000));
      denied(await later.validate({token:code.token,locationId:f.location.id}),'CLAIM_EXPIRED');denied(await later.redeem(redeemInput(f,code)),'CLAIM_EXPIRED');
      assert.equal(new Date(claim.expiresAt).getTime(),NOW.getTime()+day); // session expiry does not shorten an issued claim
      assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),0);
    });

    await t.test("claim lifetime pins membership/offer ends and does not reserve remaining capacity", async () => {
      const f=await fixture(db,{offerTerms:{endsAt:new Date(NOW.getTime()+hour).toISOString(),totalLimit:1,perShopperLimit:1,perShopperDailyLimit:1}});
      await db.rewardShopperMembership.update({where:{id:f.shopper.membership.id},data:{expiresAt:new Date(NOW.getTime()+600000)}});
      const s=await serviceFor(db,f),a=ok(await s.claim(claimInput(f)));assert.equal(a.claim.expiresAt,new Date(NOW.getTime()+600000).toISOString());
      const shopper2=await shopperFixture(db),s2=await serviceFor(db,f,shopper2);ok(await s2.claim(claimInput(f)));
      assert.equal(await db.rewardClaim.count({where:{offerId:f.offer.id}}),2);assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),0);
    });

    await t.test("parallel shoppers competing for final offer capacity cannot overspend it", async () => {
      const f=await fixture(db,{offerTerms:{totalLimit:1,perShopperLimit:1,perShopperDailyLimit:1}}),other=await shopperFixture(db),a=await serviceFor(db,f),b=await serviceFor(db,f,other);
      const x=await issued(a,f),y=await issued(b,f),results=await Promise.all([a.redeem(redeemInput(f,x.code)),b.redeem(redeemInput(f,y.code))]);
      assert.equal(results.filter(r=>r.ok).length,1);denied(results.find(r=>!r.ok),'LIMIT_REACHED');assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),1);
    });

    await t.test("UTC merchant monthly quota serializes receipts across different offers", async () => {
      const f=await fixture(db,{monthlyRedemptions:1}),next={...f,...await newOffer(db,f)},a=await serviceFor(db,f),b=await serviceFor(db,next);
      const x=await issued(a,f),y=await issued(b,next),results=await Promise.all([a.redeem(redeemInput(f,x.code)),b.redeem(redeemInput(next,y.code))]);
      assert.equal(results.filter(r=>r.ok).length,1);denied(results.find(r=>!r.ok),'LIMIT_REACHED');assert.equal(await db.rewardRedemption.count({where:{organisationId:f.organisation.id}}),1);
    });

    await t.test("same-offer history counts across revisions and later tightening does not rewrite issued limits", async () => {
      const f=await fixture(db,{offerTerms:{perShopperLimit:2,perShopperDailyLimit:2}}),s=await serviceFor(db,f),a=await issued(s,f);ok(await s.redeem(redeemInput(f,a.code)));
      const b=await issued(s,f);await publishRevision(db,f,{perShopperLimit:1,perShopperDailyLimit:1,title:'New tight terms'});
      const receipt=ok(await s.redeem(redeemInput(f,b.code))).receipt;assert.equal(receipt.revision,1);assert.equal(receipt.offerTitle,f.terms.title);
      denied(await s.claim(claimInput(f,{expectedRevision:2})),'LIMIT_REACHED');assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id,shopperId:f.shopper.shopper.id}}),2);
    });

    await t.test("daily and lifetime caps apply to concurrent legacy outstanding claims across revisions", async () => {
      for(const cap of ['personal','daily']) {
        const f=await fixture(db,{offerTerms:{perShopperLimit:cap==='personal'?1:2,perShopperDailyLimit:1}}),s=await serviceFor(db,f);
        const a=await rawClaim(db,f),revision=await publishRevision(db,f),b=await rawClaim(db,f,{revision});
        const codeA=ok(await s.credential(a.id)),codeB=ok(await s.credential(b.id));
        const results=await Promise.all([s.redeem(redeemInput(f,codeA)),s.redeem(redeemInput(f,codeB))]);
        assert.equal(results.filter(r=>r.ok).length,1);denied(results.find(r=>!r.ok),'LIMIT_REACHED');
      }
    });

    await t.test("SINGLE_USE prevents fresh claims after use and stable first-claim timezone cannot change", async () => {
      const f=await fixture(db,{offerTerms:{usage:'SINGLE_USE',perShopperLimit:1,perShopperDailyLimit:1}}),s=await serviceFor(db,f),a=await issued(s,f);
      ok(await s.redeem(redeemInput(f,a.code)));denied(await s.claim(claimInput(f)),'LIMIT_REACHED');
      await publishRevision(db,f,{timezone:'America/New_York'});denied(await s.claim(claimInput(f,{expectedRevision:2})),'CONFLICT');
      assert.equal((await db.rewardOfferUsagePolicy.findUnique({where:{offerId:f.offer.id}})).timezone,'Europe/Malta');
    });

    await t.test("Europe/Malta repeated DST hour remains one daily limit window", async () => {
      const now=new Date('2026-10-25T01:30:00Z'),f=await fixture(db,{now,offerTerms:{perShopperDailyLimit:1}}),s=await serviceFor(db,f,f.shopper,()=>now);
      const first=await rawClaim(db,f,{createdAt:new Date('2026-10-25T00:30:00Z'),expiresAt:new Date('2026-10-25T02:30:00Z')});
      await rawReceipt(db,f,first,new Date('2026-10-25T00:30:00Z'));
      denied(await s.claim(claimInput(f)),'LIMIT_REACHED');
      const tomorrow=new Date('2026-10-25T23:30:00Z');
      const next=await serviceFor(db,f,f.shopper,()=>tomorrow);ok(await next.claim(claimInput(f)));
    });

    await t.test("UTC month quota ignores previous-month receipt even when Malta calendar already changed", async () => {
      const now=new Date('2026-11-01T00:10:00Z'),f=await fixture(db,{now,monthlyRedemptions:1}),s=await serviceFor(db,f,f.shopper,()=>now);
      const old=await rawClaim(db,f,{createdAt:new Date('2026-10-31T23:30:00Z'),expiresAt:new Date('2026-11-01T01:30:00Z')});
      await rawReceipt(db,f,old,new Date('2026-10-31T23:30:00Z'));
      const fresh=await issued(s,f);ok(await s.redeem(redeemInput(f,fresh.code)));assert.equal(await db.rewardRedemption.count({where:{organisationId:f.organisation.id}}),2);
    });

    await t.test("withdrawal blocks new claims but issued honour-pause redemption keeps pinned public shop terms", async () => {
      const f=await fixture(db),s=await serviceFor(db,f),a=await issued(s,f);
      await db.rewardProgram.update({where:{id:f.program.id},data:{networkOptIn:false}});
      await db.rewardPublicShopProfile.update({where:{id:f.profile.id},data:{networkOptIn:false,displayName:'Changed public name'}});
      await db.rewardOfferDiscovery.update({where:{id:f.listing.id},data:{discoverable:false}});
      denied(await s.claim(claimInput(f)));
      await db.rewardOffer.update({where:{id:f.offer.id},data:{state:'PAUSED'}});
      const receipt=ok(await s.redeem(redeemInput(f,a.code))).receipt;assert.equal(receipt.shopName,'Public synthetic shop');
    });

    await t.test("cancellation and issued stop-when-paused policy deny consumption", async () => {
      for(const state of ['CANCELLED','PAUSED']) {
        const f=await fixture(db,{offerTerms:{pausedClaimsPolicy:'BLOCK_WHILE_PAUSED'}}),s=await serviceFor(db,f),a=await issued(s,f);
        await db.rewardOffer.update({where:{id:f.offer.id},data:{state}});denied(await s.redeem(redeemInput(f,a.code)),'CLAIM_UNAVAILABLE');
        assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),0);
      }
    });

    await t.test("shopper logout prevents code rotation but does not itself cancel issued redemption", async () => {
      const f=await fixture(db),s=await serviceFor(db,f),a=await issued(s,f);
      await db.rewardShopperSession.update({where:{id:f.shopper.session.id},data:{revokedAt:NOW}});
      denied(await s.credential(a.claim.id),'UNAUTHENTICATED');ok(await s.redeem(redeemInput(f,a.code)));
    });

    await t.test("location-scoped VIEWER REDEEM authority works without READ and rejects another shop", async () => {
      const f=await fixture(db),s=await serviceFor(db,f),a=await issued(s,f);
      await db.organisationMember.update({where:{id:f.member.id},data:{role:'VIEWER'}});
      await db.rewardStaffGrant.create({data:{organisationId:f.organisation.id,organisationMemberId:f.member.id,scope:'LOCATIONS',locationId:f.location.id,
        capabilities:['REDEEM'],startsAt:new Date('2026-01-01'),expiresAt:END}});
      const locations=ok(await s.staffLocations({}));assert.deepEqual(locations.locations.map(x=>x.id),[f.location.id]);
      ok(await s.validate({token:a.code.token,locationId:f.location.id}));ok(await s.redeem(redeemInput(f,a.code)));
      await db.rewardStaffGrant.updateMany({where:{organisationMemberId:f.member.id},data:{revokedAt:NOW}});denied(await s.validate({token:a.code.token,locationId:f.location.id}));
    });

    for(const kind of ['shopper-session','shopper-version','shopper-membership','merchant-grant','staff-session','staff-membership','shop-location'])
      await t.test(`queued ${kind} revocation is rechecked after the actual programme lock`,async()=>{
        const f=await fixture(db),s=await serviceFor(db,f),isClaim=kind.startsWith('shopper'),a=isClaim?null:await issued(s,f);
        const revoke=()=>kind==='shopper-session'?db.rewardShopperSession.update({where:{id:f.shopper.session.id},data:{revokedAt:NOW}}):
          kind==='shopper-version'?db.rewardShopper.update({where:{id:f.shopper.shopper.id},data:{authVersion:{increment:1}}}):
          kind==='shopper-membership'?db.rewardShopperMembership.update({where:{id:f.shopper.membership.id},data:{revokedAt:NOW}}):
          kind==='merchant-grant'?db.rewardEntitlementGrant.update({where:{id:f.grant.id},data:{revokedAt:NOW}}):
          kind==='staff-session'?db.session.update({where:{id:f.session.id},data:{revokedAt:NOW}}):
          kind==='staff-membership'?db.organisationMember.delete({where:{id:f.member.id}}):db.location.update({where:{id:f.location.id},data:{status:'PAUSED'}});
        const result=await waitingOnProgram(db,f.program.id,()=>isClaim?s.claim(claimInput(f)):s.redeem(redeemInput(f,a.code)),revoke);
        denied(result);assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),0);
        if(isClaim)assert.equal(await db.rewardClaim.count({where:{offerId:f.offer.id}}),0);
      });

    await t.test("queued public-profile retarget cannot issue a claim at a stale private location",async()=>{
      const f=await fixture(db),s=await serviceFor(db,f);
      const other=await db.location.create({data:{organisationId:f.organisation.id,name:'Other private location',slug:'retarget',status:'ACTIVE'}});
      const result=await waitingOnProgram(db,f.program.id,()=>s.claim(claimInput(f)),()=>db.rewardPublicShopProfile.update({where:{id:f.profile.id},data:{locationId:other.id}}));
      denied(result,'CLAIM_UNAVAILABLE');assert.equal(await db.rewardClaim.count({where:{offerId:f.offer.id}}),0);
    });

    await t.test("fixed amount saving is capped at qualifying spend; BOGO stores no invented monetary saving",async()=>{
      for(const patch of [{type:'FIXED_AMOUNT',percentBps:null,amountMinor:10000},{type:'BOGO',percentBps:null,buyQuantity:2,getQuantity:1}]) {
        const f=await fixture(db,{offerTerms:patch}),s=await serviceFor(db,f),a=await issued(s,f);
        const receipt=ok(await s.redeem(redeemInput(f,a.code))).receipt;
        assert.equal(receipt.discountMinor,patch.type==='FIXED_AMOUNT'?5000:null);
      }
    });

    await t.test("expiry after receipt insertion rolls back the whole transaction",async()=>{
      const f=await fixture(db),real=await serviceFor(db,f),a=await issued(real,f);let current=NOW;
      const wrapped=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(inner,field){
        if(field==='rewardRedemption')return new Proxy(inner.rewardRedemption,{get(delegate,method){if(method==='create')return async args=>{const row=await delegate.create(args);current=new Date(NOW.getTime()+300001);return row;};return delegate[method];}});
        const value=inner[field];return typeof value==='function'?value.bind(inner):value;
      }})),options);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
      const s=await serviceFor(wrapped,f,f.shopper,()=>current);denied(await s.redeem(redeemInput(f,a.code)),'CLAIM_EXPIRED');
      assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),0);
    });

    await t.test("late transaction failure rolls back successful-looking claims, mappings and receipts",async()=>{
      const f=await fixture(db),real=await serviceFor(db,f);
      const failing=new Proxy(db,{get(target,key){if(key==='$transaction')return async(fn,options)=>target.$transaction(async tx=>{await fn(tx);throw new Error('synthetic commit failure');},options);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
      const s=await serviceFor(failing,f);denied(await s.claim(claimInput(f)),'UNAVAILABLE');
      assert.equal(await db.rewardClaim.count({where:{offerId:f.offer.id}}),0);assert.equal(await db.rewardClaimRequest.count({where:{shopperId:f.shopper.shopper.id}}),0);
      assert.equal(await db.rewardOfferUsagePolicy.count({where:{offerId:f.offer.id}}),0);
      const a=await issued(real,f);denied(await s.redeem(redeemInput(f,a.code)),'UNAVAILABLE');assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),0);
    });

    await t.test("immutable checkout evidence aborts business reset atomically and leaves global shoppers intact",async()=>{
      const f=await fixture(db),s=await serviceFor(db,f),a=await issued(s,f);ok(await s.redeem(redeemInput(f,a.code)));
      const actor=await db.user.create({data:{email:`rr03c-final-${randomUUID()}@example.invalid`,passwordHash:'synthetic',role:'SUPER_ADMIN'}});
      const {resetSubscriberTestData,SUBSCRIBER_TEST_RESET_CONFIRMATION}=await import('../lib/subscriber-test-reset.mjs');
      const models=['organisation','user','location','rewardOfferUsagePolicy','rewardClaim','rewardClaimRequest','rewardClaimToken','rewardRedemption','rewardShopper','rewardShopperMembership','rewardShopperSession'];
      const before=await Promise.all(models.map(name=>db[name].count()));
      await assert.rejects(resetSubscriberTestData(db,{actor,retainedEmail:actor.email,confirmation:SUBSCRIBER_TEST_RESET_CONFIRMATION}));
      assert.deepEqual(await Promise.all(models.map(name=>db[name].count())),before);
      assert.ok(await db.rewardClaim.findUnique({where:{id:a.claim.id}}));
    });
  } finally { await db.$disconnect(); }
});


