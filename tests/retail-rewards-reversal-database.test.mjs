import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2027-11-14T12:00:00.000Z");
const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_REVERSAL_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const rollback = new Error("ROLL_BACK_SYNTHETIC_REWARDS_OFFER_FIXTURE");

export function reversalDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_REVERSAL_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined);
    assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
      GITHUB_JOB: "rewards-reversal-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
    assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.equal(env.DATABASE_URL, CI_URL); assert.equal(env.RUVANAS_REWARDS_DATABASE_URL, CI_URL);
    return { mode: "CI", url: new URL(CI_URL) };
  }
  assert.equal(env.RUVANAS_REWARDS_REVERSAL_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "rr03d_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.ok(["/ruvanas_rewards_reversal_full", "/ruvanas_rewards_reversal_upgrade"].includes(url.pathname));
  assert.equal(url.search, "?connection_limit=6"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr03d-20261114\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

export async function openReversalDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = reversalDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.ok(identity.version >= 160000 && identity.version < 170000);
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "rr03d_qa"); assert.equal(identity.host, "127.0.0.1"); assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-reversal-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });

test("RR-03d database tests reject unowned targets before constructing a database client", async () => {
  assert.equal(reversalDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_REVERSAL_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/unknown" },
    { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_RUN_ID: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openReversalDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openReversalDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) }));
  assert.equal(disconnected, 1);
});


const ENV = Object.freeze({ RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "true", RUVANAS_RETAIL_REWARDS_REVERSALS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false",
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

async function reversalsFor(db, f, clock = () => NOW, options = {}) {
  const { createRewardReversalService } = await import('../lib/retail-rewards/reversal-service.mjs');
  return createRewardReversalService({ db, env: ENV, loadContext: freshContext(db,f), clock, ...options });
}
const reverseInput=(f,receipt,patch={})=>({redemptionId:receipt.id,locationId:f.location.id,reason:'WRONG_COUPON',idempotencyKey:randomUUID(),correctionConfirmed:true,...patch});
async function redeemed(db, options={}) {
  const f=await fixture(db,options),checkout=await serviceFor(db,f,f.shopper,()=>options.now||NOW),{claim,code}=await issued(checkout,f);
  const request=redeemInput(f,code),receipt=ok(await checkout.redeem(request)).receipt;
  return {...f,checkout,claim,code,request,receipt,reversals:await reversalsFor(db,f,()=>options.now||NOW)};
}
async function rawReversal(db,f,receipt,patch={}) {
  return db.rewardRedemptionReversal.create({data:{organisationId:f.organisation.id,redemptionId:receipt.id,
    actorUserId:f.user.id,actorOrganisationMemberId:f.member.id,reason:'WRONG_COUPON',
    idempotencyKeyHash:randomBytes(32).toString('hex'),requestHash:randomBytes(32).toString('hex'),occurredAt:NOW,...patch}});
}
async function explicitManager(db,f,capabilities=['REVERSE'],scope='LOCATIONS',locationId=f.location.id) {
  await db.organisationMember.update({where:{id:f.member.id},data:{role:'MANAGER'}});
  return db.rewardStaffGrant.create({data:{organisationId:f.organisation.id,organisationMemberId:f.member.id,scope,locationId,
    capabilities,startsAt:new Date('2026-01-01'),expiresAt:END}});
}

test('RR-03d PostgreSQL immutable corrections, net offer use and gross monthly quota',{
  skip:!requested&&'Requires owned disposable RR-03d PostgreSQL or its dedicated reversal CI job.'
},async t=>{
  const {db}=await openReversalDatabase(process.env);
  try {
    assert.equal(await db.rewardRedemptionReversal.count(),0,'Expected fresh reversal schema, never application data');
    const priorReceipts=await db.rewardRedemption.count();
    await t.test('business reset still works with no Rewards evidence and preserves global shoppers',{skip:priorReceipts>0&&'Upgrade intentionally preserves immutable legacy checkout evidence'},()=>syntheticTransaction(db,async tx=>{
      const s=await shopperFixture(tx),actor=await tx.user.create({data:{email:`rr03d-reset-${randomUUID()}@example.invalid`,passwordHash:'synthetic',role:'SUPER_ADMIN'}});
      const before=await tx.rewardShopper.findUnique({where:{id:s.shopper.id}});
      const {resetSubscriberTestData,SUBSCRIBER_TEST_RESET_CONFIRMATION}=await import('../lib/subscriber-test-reset.mjs');
      await resetSubscriberTestData({$transaction:fn=>fn(tx)},{actor,retainedEmail:actor.email,confirmation:SUBSCRIBER_TEST_RESET_CONFIRMATION});
      assert.deepEqual(await tx.rewardShopper.findUnique({where:{id:s.shopper.id}}),before);assert.equal(await tx.organisation.count(),0);
    }));

    await t.test('reversal foreign key requires exact same-tenant receipt; hashes reasons and timestamps are constrained',()=>syntheticTransaction(db,async tx=>{
      const f=await fixture(tx),other=await fixture(tx),claim=await rawClaim(tx,f),receipt=await rawReceipt(tx,f,claim);
      const insert='INSERT INTO "RewardRedemptionReversal" (id,"organisationId","redemptionId","actorUserId","actorOrganisationMemberId",reason,"idempotencyKeyHash","requestHash","occurredAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)';
      const values=[randomUUID(),f.organisation.id,receipt.id,f.user.id,f.member.id,'WRONG_COUPON','a'.repeat(64),'b'.repeat(64),NOW];
      await rejectsSql(tx,insert,values.map((v,i)=>i===1?other.organisation.id:v),['23503']);
      await rejectsSql(tx,insert,values.map((v,i)=>i===2?'missing-receipt':v),['23503']);
      for(const [index,value] of [[0,'bad id'],[3,''],[4,'private email@example.invalid'],[5,'CUSTOMER_EMAIL'],[6,'raw-idempotency-key'],[7,'A'.repeat(64)],[8,'infinity']])
        await rejectsSql(tx,insert,values.map((v,i)=>i===index?value:v));
      await rawReversal(tx,f,receipt);
      await rejectsSql(tx,insert,values,['23505']);
    }));

    await t.test('reversal evidence rejects update delete truncate and cascade without mutating the original receipt',()=>syntheticTransaction(db,async tx=>{
      const f=await fixture(tx),claim=await rawClaim(tx,f),receipt=await rawReceipt(tx,f,claim),reversal=await rawReversal(tx,f,receipt);
      await rejectsSql(tx,'UPDATE "RewardRedemptionReversal" SET reason=reason WHERE id=$1',[reversal.id],['55000']);
      await rejectsSql(tx,'DELETE FROM "RewardRedemptionReversal" WHERE id=$1',[reversal.id],['55000']);
      await rejectsSql(tx,'TRUNCATE "RewardRedemptionReversal" CASCADE',[],['55000']);
      await rejectsSql(tx,'DELETE FROM "RewardRedemption" WHERE id=$1',[receipt.id],['55000','23503','23001']);
      assert.deepEqual(await tx.rewardRedemption.findUnique({where:{id:receipt.id}}),receipt);
      assert.deepEqual(await tx.rewardClaim.findUnique({where:{id:claim.id}}),claim);
    }));

    await t.test('owner inspection is read-only; one correction preserves receipt and records a bounded reason',async()=>{
      const f=await redeemed(db),before=await db.rewardRedemption.findUnique({where:{id:f.receipt.id}});
      const view=ok(await f.reversals.inspect({redemptionId:f.receipt.id,locationId:f.location.id}));
      assert.equal(view.canReverse,true);assert.equal(view.deadline,new Date(NOW.getTime()+day).toISOString());assert.equal(view.receipt.reversal,null);
      assert.equal(await db.rewardRedemptionReversal.count({where:{redemptionId:f.receipt.id}}),0);
      const result=ok(await f.reversals.reverse(reverseInput(f,f.receipt)));assert.equal(result.receipt.reversal.reason,'WRONG_COUPON');
      assert.equal(result.receipt.id,f.receipt.id);assert.equal(result.receipt.eligibleSpendMinor,f.receipt.eligibleSpendMinor);assert.equal(result.receipt.discountMinor,f.receipt.discountMinor);
      assert.deepEqual(await db.rewardRedemption.findUnique({where:{id:f.receipt.id}}),before);
      assert.equal(ok(await f.reversals.inspect({redemptionId:f.receipt.id,locationId:f.location.id})).canReverse,false);
      for(const secret of [f.organisation.id,f.shopper.shopper.id,f.user.id,f.location.id,f.code.token])assert.ok(!JSON.stringify(result).includes(secret));
    });

    await t.test('same-key exact retry works after the window; changed payload and another key cannot reverse twice',async()=>{
      const f=await redeemed(db),input=reverseInput(f,f.receipt),result=ok(await f.reversals.reverse(input));
      assert.deepEqual(ok(await f.reversals.reverse(input)),result);
      const later=await reversalsFor(db,f,()=>new Date(NOW.getTime()+day+1000));assert.deepEqual(ok(await later.reverse(input)),result);
      denied(await later.reverse({...input,reason:'PURCHASE_CANCELLED'}),'CONFLICT');
      denied(await f.reversals.reverse({...input,idempotencyKey:randomUUID()}),'ALREADY_REVERSED');
      assert.equal(await db.rewardRedemptionReversal.count({where:{redemptionId:f.receipt.id}}),1);
    });

    await t.test('concurrent same and different request keys yield one immutable correction',async()=>{
      const f=await redeemed(db),input=reverseInput(f,f.receipt),results=await Promise.all([
        f.reversals.reverse(input),f.reversals.reverse(input),f.reversals.reverse({...input,idempotencyKey:randomUUID()})]);
      assert.ok(results.some(r=>r.ok));assert.equal(new Set(results.filter(r=>r.ok).map(r=>r.receipt.reversal.id)).size,1);
      results.filter(r=>!r.ok).forEach(r=>denied(r,'ALREADY_REVERSED'));
      assert.equal(await db.rewardRedemptionReversal.count({where:{redemptionId:f.receipt.id}}),1);
    });

    await t.test('wrong tenant location role and shopper-only context never reveal or reverse a receipt',async()=>{
      const f=await redeemed(db),foreign=await fixture(db),other=await reversalsFor(db,foreign);
      denied(await other.inspect({redemptionId:f.receipt.id,locationId:foreign.location.id}),'REDEMPTION_UNAVAILABLE');
      denied(await other.reverse(reverseInput(foreign,f.receipt)),'REDEMPTION_UNAVAILABLE');
      const second=await db.location.create({data:{organisationId:f.organisation.id,name:'Other shop',slug:'other',status:'ACTIVE'}});
      denied(await f.reversals.inspect({redemptionId:f.receipt.id,locationId:second.id}),'REDEMPTION_UNAVAILABLE');
      await db.organisationMember.update({where:{id:f.member.id},data:{role:'VIEWER'}});
      await db.rewardStaffGrant.create({data:{organisationId:f.organisation.id,organisationMemberId:f.member.id,scope:'LOCATIONS',locationId:f.location.id,
        capabilities:['REDEEM','REVERSE'],startsAt:new Date('2026-01-01'),expiresAt:END}});
      denied(await f.reversals.inspect({redemptionId:f.receipt.id,locationId:f.location.id}),'FORBIDDEN');denied(await f.reversals.reverse(reverseInput(f,f.receipt)),'FORBIDDEN');
      const shopperOnly=await reversalsFor(db,f,()=>NOW,{loadContext:async()=>null});denied(await shopperOnly.reverse(reverseInput(f,f.receipt)),'UNAUTHENTICATED');
      assert.equal(await db.rewardRedemptionReversal.count({where:{redemptionId:f.receipt.id}}),0);
    });

    await t.test('manager with location REVERSE alone sees and corrects only that shop',async()=>{
      const f=await redeemed(db);await explicitManager(db,f);
      const second=await db.location.create({data:{organisationId:f.organisation.id,name:'Other shop',slug:'other',status:'ACTIVE'}});
      const locations=ok(await f.reversals.locations({}));assert.deepEqual(locations.locations.map(x=>x.id),[f.location.id]);
      denied(await f.reversals.reverse(reverseInput(f,f.receipt,{locationId:second.id})),'LOCATION_UNAVAILABLE');
      ok(await f.reversals.reverse(reverseInput(f,f.receipt)));
    });

    await t.test('correction window is elapsed time with an exclusive 24 hour boundary',async()=>{
      for(const delta of [day-1,day,day+1]) {
        const f=await redeemed(db),s=await reversalsFor(db,f,()=>new Date(NOW.getTime()+delta));
        const inspected=ok(await s.inspect({redemptionId:f.receipt.id,locationId:f.location.id}));assert.equal(inspected.canReverse,delta<day);
        const result=await s.reverse(reverseInput(f,f.receipt));if(delta<day)ok(result);else denied(result,'REVERSAL_WINDOW_CLOSED');
      }
    });

    await t.test('cancelled offer and revoked expired shopper do not prevent correction by an authorised manager',async()=>{
      const f=await redeemed(db);await db.rewardOffer.update({where:{id:f.offer.id},data:{state:'CANCELLED'}});
      await db.rewardShopper.update({where:{id:f.shopper.shopper.id},data:{status:'SUSPENDED',authVersion:{increment:1}}});
      await db.rewardShopperMembership.update({where:{id:f.shopper.membership.id},data:{revokedAt:NOW,expiresAt:NOW}});
      ok(await f.reversals.reverse(reverseInput(f,f.receipt)));
      denied(await f.checkout.claim(claimInput(f)));assert.equal(await db.rewardClaim.count({where:{offerId:f.offer.id}}),1);
    });

    await t.test('net offer total lifetime and daily allowance restore only through a fresh eligible claim',async()=>{
      const f=await redeemed(db,{offerTerms:{usage:'SINGLE_USE',totalLimit:1,perShopperLimit:1,perShopperDailyLimit:1}});
      denied(await f.checkout.claim(claimInput(f)),'LIMIT_REACHED');ok(await f.reversals.reverse(reverseInput(f,f.receipt)));
      const wallet=ok(await f.checkout.wallet({}));assert.equal(wallet.claims[0].status,'REVERSED');assert.equal(wallet.claims[0].receipt.reversal.reason,'WRONG_COUPON');
      denied(await f.checkout.credential(f.claim.id),'ALREADY_REDEEMED');denied(await f.checkout.redeem({...f.request,idempotencyKey:randomUUID()}),'ALREADY_REDEEMED');
      const replay=ok(await f.checkout.redeem(f.request));assert.equal(replay.receipt.id,f.receipt.id);assert.ok(replay.receipt.reversal);
      const fresh=await issued(f.checkout,f);assert.notEqual(fresh.claim.id,f.claim.id);ok(await f.checkout.redeem(redeemInput(f,fresh.code)));
      denied(await f.checkout.claim(claimInput(f)),'LIMIT_REACHED');assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),2);
    });

    await t.test('gross merchant monthly service quota never replenishes after a correction',async()=>{
      const f=await redeemed(db,{monthlyRedemptions:1});ok(await f.reversals.reverse(reverseInput(f,f.receipt)));
      denied(await f.checkout.claim(claimInput(f)),'LIMIT_REACHED');
      const second={...f,...await newOffer(db,f)},checkout=await serviceFor(db,second);denied(await checkout.claim(claimInput(second)),'LIMIT_REACHED');
      assert.equal(await db.rewardRedemption.count({where:{organisationId:f.organisation.id}}),1);
    });

    await t.test('reversed history still restores net counts with reversals disabled and new revisions retain history',async()=>{
      const f=await redeemed(db,{offerTerms:{totalLimit:1,perShopperLimit:1,perShopperDailyLimit:1}});ok(await f.reversals.reverse(reverseInput(f,f.receipt)));
      const revision=await publishRevision(db,f,{title:'A newer reviewed coupon'});
      const checkout=await serviceFor(db,f,f.shopper,()=>NOW,{env:{...ENV,RUVANAS_RETAIL_REWARDS_REVERSALS_ENABLED:'false'}});
      const next=await issued(checkout,f,claimInput(f,{expectedRevision:revision}));assert.equal(next.claim.revision,2);ok(await checkout.redeem(redeemInput(f,next.code)));
      assert.equal(ok(await checkout.redeem(f.request)).receipt.reversal.reason,'WRONG_COUPON');
      denied(await checkout.credential(f.claim.id),'ALREADY_REDEEMED');
    });

    await t.test('reversal racing a final-capacity redemption shares the programme lock without corrupting net or gross counts',async()=>{
      const f=await redeemed(db,{offerTerms:{totalLimit:1,perShopperLimit:1,perShopperDailyLimit:1}}),other=await shopperFixture(db),otherService=await serviceFor(db,f,other);
      // Historical outstanding claims reserve nothing, so redemption must arbitrate against correction.
      const claim=await rawClaim(db,f,{shopper:other}),code=ok(await otherService.credential(claim.id));
      const results=await Promise.all([f.reversals.reverse(reverseInput(f,f.receipt)),otherService.redeem(redeemInput(f,code))]);ok(results[0]);
      if(!results[1].ok){denied(results[1],'LIMIT_REACHED');ok(await otherService.redeem(redeemInput(f,code)));}else ok(results[1]);
      const counts=await db.$queryRaw`SELECT count(*)::int AS gross, count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM "RewardRedemptionReversal" v WHERE v."redemptionId"=r.id AND v."organisationId"=r."organisationId"))::int AS net FROM "RewardRedemption" r WHERE r."offerId"=${f.offer.id}`;
      assert.deepEqual(counts,[{gross:2,net:1}]);
    });

    await t.test('reversal racing fresh claim creation cannot issue duplicate active claims',async()=>{
      const f=await redeemed(db,{offerTerms:{totalLimit:1,perShopperLimit:1,perShopperDailyLimit:1}}),results=await Promise.all([
        f.reversals.reverse(reverseInput(f,f.receipt)),f.checkout.claim(claimInput(f)),f.checkout.claim(claimInput(f))]);ok(results[0]);
      for(const result of results.slice(1))if(!result.ok)denied(result,'LIMIT_REACHED');
      const fresh=ok(await f.checkout.claim(claimInput(f))).claim;
      const active=await db.rewardClaim.findMany({where:{offerId:f.offer.id,shopperId:f.shopper.shopper.id,redemption:null,expiresAt:{gt:NOW}}});
      assert.equal(active.length,1);assert.equal(active[0].id,fresh.id);
    });

    for(const kind of ['session','member-role','member-removal','grant','location','staff-grant'])await t.test(`queued ${kind} revocation denies correction after the real programme lock`,async()=>{
      const f=await redeemed(db),staff=kind==='staff-grant'?await explicitManager(db,f):null;
      const revoke=()=>kind==='session'?db.session.update({where:{id:f.session.id},data:{revokedAt:NOW}}):
        kind==='member-role'?db.organisationMember.update({where:{id:f.member.id},data:{role:'VIEWER'}}):
        kind==='member-removal'?db.organisationMember.delete({where:{id:f.member.id}}):
        kind==='grant'?db.rewardEntitlementGrant.update({where:{id:f.grant.id},data:{revokedAt:NOW}}):
        kind==='location'?db.location.update({where:{id:f.location.id},data:{status:'PAUSED'}}):db.rewardStaffGrant.update({where:{id:staff.id},data:{revokedAt:NOW}});
      denied(await waitingOnProgram(db,f.program.id,()=>f.reversals.reverse(reverseInput(f,f.receipt)),revoke));
      assert.equal(await db.rewardRedemptionReversal.count({where:{redemptionId:f.receipt.id}}),0);
    });

    for(const operation of ['reverse','redeem'])for(const boundary of ['before-transaction','waiting-on-programme'])await t.test(`${operation} fails closed when OWNER becomes an authorised MANAGER ${boundary}`,async()=>{
      const f=operation==='reverse'?await redeemed(db):await fixture(db);
      const checkout=operation==='redeem'?await serviceFor(db,f):null;
      const fresh=checkout?await issued(checkout,f):null;
      const input=operation==='reverse'?reverseInput(f,f.receipt):redeemInput(f,fresh.code);
      const transition=()=>explicitManager(db,f,[operation==='reverse'?'REVERSE':'REDEEM']);
      let result;
      if(boundary==='waiting-on-programme'){
        const service=operation==='reverse'?f.reversals:checkout;
        result=await waitingOnProgram(db,f.program.id,()=>service[operation](input),transition);
      }else{
        let transitioned=false;
        const wrapped=new Proxy(db,{get(target,key){
          if(key==='$transaction')return async(fn,options)=>{if(!transitioned){transitioned=true;await transition();}return target.$transaction(fn,options);};
          const value=target[key];return typeof value==='function'?value.bind(target):value;
        }});
        const service=operation==='reverse'?await reversalsFor(wrapped,f):await serviceFor(wrapped,f);
        result=await service[operation](input);
        assert.equal(transitioned,true,'The role transition must occur before the real transaction begins');
      }
      denied(result,'FORBIDDEN');
      assert.equal(await db.rewardRedemptionReversal.count({where:{organisationId:f.organisation.id}}),0);
      assert.equal(await db.rewardRedemption.count({where:{organisationId:f.organisation.id}}),operation==='reverse'?1:0);
      // A new request can use the current explicit manager grant and locks it normally.
      const current=operation==='reverse'?await reversalsFor(db,f):await serviceFor(db,f);
      ok(await current[operation]({...input,idempotencyKey:randomUUID()}));
    });

    await t.test('completed idempotency retry still requires current manager permission',async()=>{
      const f=await redeemed(db),input=reverseInput(f,f.receipt);ok(await f.reversals.reverse(input));
      await db.session.update({where:{id:f.session.id},data:{revokedAt:NOW}});denied(await f.reversals.reverse(input),'UNAUTHENTICATED');
    });

    await t.test('deadline passing after insert rolls back the reversal without changing receipt or quotas',async()=>{
      const f=await redeemed(db);let now=new Date(NOW.getTime()+day-1);
      const wrapped=new Proxy(db,{get(target,key){if(key==='$transaction')return(fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(inner,field){
        if(field==='rewardRedemptionReversal')return new Proxy(inner.rewardRedemptionReversal,{get(delegate,method){if(method==='create')return async args=>{const row=await delegate.create(args);now=new Date(NOW.getTime()+day);return row;};return delegate[method];}});
        const value=inner[field];return typeof value==='function'?value.bind(inner):value;
      }})),options);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
      const s=await reversalsFor(wrapped,f,()=>now);denied(await s.reverse(reverseInput(f,f.receipt)),'REVERSAL_WINDOW_CLOSED');
      assert.equal(await db.rewardRedemptionReversal.count({where:{redemptionId:f.receipt.id}}),0);
      assert.ok(await db.rewardRedemption.findUnique({where:{id:f.receipt.id}}));
    });

    await t.test('late transaction exception rolls back correction and permits a clean same-key retry',async()=>{
      const f=await redeemed(db),input=reverseInput(f,f.receipt);
      const wrapped=new Proxy(db,{get(target,key){if(key==='$transaction')return(fn,options)=>target.$transaction(async tx=>{await fn(tx);throw new Error('synthetic commit failure');},options);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
      denied(await(await reversalsFor(wrapped,f)).reverse(input),'UNAVAILABLE');assert.equal(await db.rewardRedemptionReversal.count({where:{redemptionId:f.receipt.id}}),0);ok(await f.reversals.reverse(input));
    });

    await t.test('immutable reversal history blocks business reset atomically and preserves shopper/global rows',async()=>{
      const f=await redeemed(db);ok(await f.reversals.reverse(reverseInput(f,f.receipt)));
      const actor=await db.user.create({data:{email:`rr03d-final-${randomUUID()}@example.invalid`,passwordHash:'synthetic',role:'SUPER_ADMIN'}});
      const models=['organisation','user','location','rewardClaim','rewardRedemption','rewardRedemptionReversal','rewardShopper','rewardShopperMembership','rewardShopperSession'];
      const before=await Promise.all(models.map(name=>db[name].count()));
      const {resetSubscriberTestData,SUBSCRIBER_TEST_RESET_CONFIRMATION}=await import('../lib/subscriber-test-reset.mjs');
      await assert.rejects(resetSubscriberTestData(db,{actor,retainedEmail:actor.email,confirmation:SUBSCRIBER_TEST_RESET_CONFIRMATION}));
      assert.deepEqual(await Promise.all(models.map(name=>db[name].count())),before);
    });
  } finally {await db.$disconnect();}
});
