import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { safeCheckoutResult } from "../lib/retail-rewards/checkout-dtos.mjs";

const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2027-11-14T12:00:00.000Z");
const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_WALLET_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function walletDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_WALLET_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined);
    assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
      GITHUB_JOB: "rewards-wallet-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
    assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.equal(env.DATABASE_URL, CI_URL); assert.equal(env.RUVANAS_REWARDS_DATABASE_URL, CI_URL);
    return { mode: "CI", url: new URL(CI_URL) };
  }
  assert.equal(env.RUVANAS_REWARDS_WALLET_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "wallet_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.equal(url.pathname, "/ruvanas_rewards_wallet_usage");
  assert.equal(url.search, "?connection_limit=6"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-wallet-20261118\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

export async function openWalletDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = walletDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    assert.ok(identity.version >= 160000 && identity.version < 170000);
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "wallet_qa"); assert.equal(identity.host, "127.0.0.1");
      assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

test("wallet PostgreSQL check rejects unowned databases before constructing a client", async () => {
  const cluster=path.resolve("output/retail-rewards-wallet-20261118/sessions/postgres-123-1234567890/postgres");
  const url="postgresql://wallet_qa@127.0.0.1:54433/ruvanas_rewards_wallet_usage?connection_limit=6";
  const env={RUN_DATABASE_TESTS:"1",RUVANAS_REWARDS_WALLET_LOCAL_TEST:"1",DATABASE_URL:url,
    RUVANAS_REWARDS_DATABASE_URL:url,RUVANAS_REWARDS_CLUSTER_DIR:cluster};
  const options={realpath:value=>value};
  assert.equal(walletDatabaseTarget(env,options).url.hostname,"127.0.0.1");
  for (const patch of [{RUN_DATABASE_TESTS:"0"},{RUVANAS_REWARDS_WALLET_LOCAL_TEST:"true"},
    {RUVANAS_REWARDS_CI_TEST:"1"},{DATABASE_URL:undefined},{RUVANAS_REWARDS_CLUSTER_DIR:path.resolve("unknown")},
    {RUVANAS_REWARDS_DATABASE_URL:url.replace("127.0.0.1","production.invalid")},
    {RUVANAS_REWARDS_DATABASE_URL:url.replace("wallet_qa","postgres")},
    {RUVANAS_REWARDS_DATABASE_URL:url.replace("54433","5432")},
    {RUVANAS_REWARDS_DATABASE_URL:url.replace("wallet_usage","production")},
    {RUVANAS_REWARDS_DATABASE_URL:url+"&schema=public"}]) {
    let clients=0;
    await assert.rejects(openWalletDatabase({...env,...patch},{...options,createClient:()=>{clients++;}}));
    assert.equal(clients,0);
  }
  let disconnected=0;
  await assert.rejects(openWalletDatabase(env,{...options,createClient:()=>({
    $queryRawUnsafe:async()=>[{directory:"/wrong",database:"production",role:"postgres",host:"127.0.0.1",port:54433,version:160000}],
    $disconnect:async()=>{disconnected++;}
  })}));
  assert.equal(disconnected,1);
});

test("wallet CI database guard accepts only its dedicated hosted PostgreSQL16 job", async () => {
  const env = { RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
    RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
    GITHUB_JOB: "rewards-wallet-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
    GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" };
  assert.equal(walletDatabaseTarget(env, { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_WALLET_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/unknown" },
    { GITHUB_ACTIONS: "false" }, { CI: "false" }, { GITHUB_WORKFLOW: "Other" },
    { GITHUB_JOB: "rewards-checkout-database" }, { GITHUB_JOB: "validate" },
    { RUNNER_ENVIRONMENT: "self-hosted" }, { RUNNER_OS: "Windows" },
    { GITHUB_REPOSITORY: undefined }, { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ATTEMPT: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.invalid") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: CI_URL.replace(":5432/", ":5433/") },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openWalletDatabase({ ...env, ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  assert.throws(() => walletDatabaseTarget(env, { platform: "win32" }));
  const identity = { directory: "/var/lib/postgresql/data", database: "ruvanas_rewards_ci", role: "rewards_ci", host: "172.17.0.2", port: 5432, version: 160016 };
  for (const patch of [{ directory: "/production" }, { database: "production" }, { role: "postgres" },
    { host: "" }, { port: 5433 }, { version: 150000 }, { version: 170000 }]) {
    let disconnected = 0;
    await assert.rejects(openWalletDatabase(env, { platform: "linux", createClient: () => ({
      $queryRawUnsafe: async () => [{ ...identity, ...patch }], $disconnect: async () => { disconnected++; }
    }) }));
    assert.equal(disconnected, 1);
  }
  const result = await openWalletDatabase(env, { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [identity], $disconnect: async () => {}
  }) });
  assert.equal(result.target.mode, "CI");
  await result.db.$disconnect();
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

async function rawReversal(db,f,receipt) {
  return db.rewardRedemptionReversal.create({data:{organisationId:f.organisation.id,redemptionId:receipt.id,
    actorUserId:f.user.id,actorOrganisationMemberId:f.member.id,reason:"WRONG_COUPON",
    idempotencyKeyHash:randomBytes(32).toString("hex"),requestHash:randomBytes(32).toString("hex"),occurredAt:NOW}});
}
function assertUsage(claim,used,limit,status) {
  assert.deepEqual(claim.usage,{used,limit,remaining:Math.max(0,limit-used),asOf:NOW.toISOString()});
  if (status) assert.equal(claim.status,status);
}
function projected(operation,result) {
  ok(result); assert.deepEqual(safeCheckoutResult(operation,result),result,"Strict public projection must accept real database result");
  return result;
}

test("PostgreSQL wallet uses-left remains scoped, immutable and read-only",{
  skip:!requested&&"Requires the dedicated owned local or isolated GitHub CI wallet PostgreSQL16 fixture."
},async t=>{
  const {db}=await openWalletDatabase(process.env);
  try {
    assert.equal(await db.rewardClaim.count(),0,"Require a new synthetic database, never application data");
    await t.test("net personal uses span revisions and locations, exclude other shoppers/offers/tenants, and preserve statuses",async()=>{
      const f=await fixture(db),secondLocation=await db.location.create({data:{organisationId:f.organisation.id,name:"Synthetic second location",slug:"second",status:"ACTIVE"}});
      const first=await rawClaim(db,f); await rawReceipt(db,f,first);
      const oldReady=await rawClaim(db,f);
      const expired=await rawClaim(db,f,{createdAt:new Date(NOW.getTime()-2*hour),expiresAt:new Date(NOW.getTime()-hour)});
      await publishRevision(db,f,{locationIds:[f.location.id,secondLocation.id],perShopperLimit:4,perShopperDailyLimit:4});
      const second=await rawClaim(db,f,{revision:2,locationId:secondLocation.id}); await rawReceipt(db,f,second);
      const reversed=await rawClaim(db,f,{revision:2}); await rawReversal(db,f,await rawReceipt(db,f,reversed));
      const ready=await rawClaim(db,f,{revision:2});
      const stranger=await shopperFixture(db);
      const strangerClaim=await rawClaim(db,f,{shopper:stranger,revision:2}); await rawReceipt(db,f,strangerClaim);
      const sibling={...f,...await newOffer(db,f)};
      const siblingClaim=await rawClaim(db,sibling); await rawReceipt(db,sibling,siblingClaim);
      const other={...await fixture(db),shopper:f.shopper};
      const otherClaim=await rawClaim(db,other); await rawReceipt(db,other,otherClaim);
      const service=await serviceFor(db,f);
      const before={receipts:await db.rewardRedemption.count(),claims:await db.rewardClaim.count(),tokens:await db.rewardClaimToken.count()};
      const wallet=projected("wallet",await service.wallet());
      const byId=new Map(wallet.claims.map(claim=>[claim.id,claim]));
      assert.equal(wallet.claims.length,8); assert.equal(wallet.hasMore,false);
      assert.equal(byId.has(strangerClaim.id),false,"Never expose another shopper's claim");
      assertUsage(byId.get(first.id),2,10,"REDEEMED"); assertUsage(byId.get(oldReady.id),2,10,"READY");
      assertUsage(byId.get(expired.id),2,10,"EXPIRED"); assertUsage(byId.get(second.id),2,4,"REDEEMED");
      assertUsage(byId.get(reversed.id),2,4,"REVERSED"); assertUsage(byId.get(ready.id),2,4,"READY");
      assertUsage(byId.get(siblingClaim.id),1,10,"REDEEMED"); assertUsage(byId.get(otherClaim.id),1,10,"REDEEMED");
      for(const claim of wallet.claims) {
        for(const key of ["organisationId","offerId","shopperId","locationId","token","tokenHash"]) assert.equal(Object.hasOwn(claim,key),false);
        assert.equal(Object.hasOwn(claim.terms,"locationIds"),false);
      }
      assert.deepEqual({receipts:await db.rewardRedemption.count(),claims:await db.rewardClaim.count(),tokens:await db.rewardClaimToken.count()},before,"Reading balances must not issue or consume anything");
      await db.rewardOffer.update({where:{id:f.offer.id},data:{state:"CANCELLED"}});
      const unavailable=projected("wallet",await service.wallet());
      const after=new Map(unavailable.claims.map(claim=>[claim.id,claim]));
      assertUsage(after.get(ready.id),2,4,"UNAVAILABLE"); assertUsage(after.get(oldReady.id),2,10,"UNAVAILABLE");
      assertUsage(after.get(reversed.id),2,4,"REVERSED"); assertUsage(after.get(first.id),2,10,"REDEEMED");
      assertUsage(after.get(expired.id),2,10,"EXPIRED");
    });
    await t.test("claim, duplicate and idempotent retry, credentials and refresh use the same real receipt count",async()=>{
      const f=await fixture(db,{offerTerms:{perShopperLimit:2,perShopperDailyLimit:2}}),service=await serviceFor(db,f);
      const history=await rawClaim(db,f); await rawReceipt(db,f,history);
      const request=claimInput(f),created=projected("claim",await service.claim(request));
      assertUsage(created.claim,1,2,"READY");
      assert.deepEqual(projected("claim",await service.claim(request)),created,"Idempotent retry returns same claim and usage");
      assert.deepEqual(projected("claim",await service.claim(claimInput(f))),created,"Duplicate active claim reuses the existing claim");
      const code=projected("credential",await service.credential(created.claim.id)); assertUsage(code.claim,1,2,"READY");
      const rotated=projected("credential",await service.credential(created.claim.id)); assertUsage(rotated.claim,1,2,"READY");
      assert.notEqual(rotated.token,code.token); assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),1);
      const redemption=redeemInput(f,rotated); projected("redeem",await service.redeem(redemption));
      projected("redeem",await service.redeem(redemption));
      const wallet=projected("wallet",await service.wallet());
      for(const claim of wallet.claims) assertUsage(claim,2,2,"REDEEMED");
      assert.equal(await db.rewardRedemption.count({where:{offerId:f.offer.id}}),2,"Receipt retry must not consume another use");
      assertUsage(projected("claim",await service.claim(request)).claim,2,2,"REDEEMED");
      denied(await service.claim(claimInput(f)),"LIMIT_REACHED");
      denied(await service.credential(created.claim.id),"ALREADY_REDEEMED");
      denied(await service.redeem(redeemInput(f,rotated)),"ALREADY_REDEEMED");
      await rawReversal(db,f,await db.rewardRedemption.findUnique({where:{claimId:created.claim.id}}));
      const corrected=projected("wallet",await service.wallet());
      assertUsage(corrected.claims.find(c=>c.id===created.claim.id),1,2,"REVERSED");
      assertUsage(projected("claim",await service.claim(claimInput(f))).claim,1,2,"READY");
    });
    await t.test("single-use receipts display zero left, claims do not consume it and revoked shoppers cannot read balances",async()=>{
      const f=await fixture(db,{offerTerms:{usage:"SINGLE_USE",perShopperLimit:1,perShopperDailyLimit:1}}),service=await serviceFor(db,f);
      const {claim,code}=await issued(service,f);
      assertUsage(claim,0,1,"READY"); assertUsage(projected("credential",code).claim,0,1,"READY");
      projected("redeem",await service.redeem(redeemInput(f,code)));
      assertUsage(projected("wallet",await service.wallet()).claims[0],1,1,"REDEEMED");
      await db.rewardShopperSession.update({where:{id:f.shopper.session.id},data:{revokedAt:NOW}});
      denied(await service.wallet()); denied(await service.credential(claim.id));
      const disabled=await serviceFor(db,f,f.shopper,()=>NOW,{env:{...ENV,RUVANAS_RETAIL_REWARDS_ENABLED:"false"}});
      denied(await disabled.wallet());
    });
  } finally {await db.$disconnect();}
});
