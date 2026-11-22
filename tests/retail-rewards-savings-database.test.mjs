import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createShopperSavingsService } from "../lib/retail-rewards/shopper-savings-service.mjs";
import { requireRewardShopperAccess } from "../lib/retail-rewards/shopper-access.mjs";
import { walletCiDatabaseTarget, verifyWalletCiDatabaseIdentity } from "./fixtures/rewards-wallet-ci-target.mjs";
const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2027-11-14T12:00:00.000Z");
const requested = process.env.RUVANAS_REWARDS_SAVINGS_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function savingsDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    return walletCiDatabaseTarget(env, { platform });
  }
  assert.equal(env.RUVANAS_REWARDS_SAVINGS_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "savings_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.equal(url.pathname, "/ruvanas_rewards_savings");
  assert.equal(url.search, "?connection_limit=6"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-shopper-dashboard-20261122\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

export async function openSavingsDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = savingsDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    assert.ok(identity.version >= 160000 && identity.version < 170000);
    if (target.mode === "CI") verifyWalletCiDatabaseIdentity(identity);
    else {
      assert.equal(identity.role, "savings_qa"); assert.equal(identity.host, "127.0.0.1");
      assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

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

test("savings database guard rejects any unowned target before a client is opened", async () => {
  const cluster = path.resolve("output/retail-rewards-shopper-dashboard-20261122/sessions/postgres-123-1234567890/postgres");
  const url = "postgresql://savings_qa@127.0.0.1:54433/ruvanas_rewards_savings?connection_limit=6";
  const env = { RUN_DATABASE_TESTS:"1", RUVANAS_REWARDS_SAVINGS_LOCAL_TEST:"1", DATABASE_URL:url, RUVANAS_REWARDS_DATABASE_URL:url, RUVANAS_REWARDS_CLUSTER_DIR:cluster };
  assert.equal(savingsDatabaseTarget(env,{realpath:value=>value}).mode,"LOCAL");
  for (const patch of [{RUN_DATABASE_TESTS:"0"},{RUVANAS_REWARDS_SAVINGS_LOCAL_TEST:"true"},{RUVANAS_REWARDS_CI_TEST:"1"},
    {DATABASE_URL:undefined},{RUVANAS_REWARDS_CLUSTER_DIR:path.resolve("unknown")},
    {RUVANAS_REWARDS_DATABASE_URL:url.replace("127.0.0.1","production.invalid")},{RUVANAS_REWARDS_DATABASE_URL:url.replace("savings_qa","postgres")}]) {
    let clients=0;
    await assert.rejects(openSavingsDatabase({...env,...patch},{realpath:value=>value,createClient:()=>{clients++;}}));
    assert.equal(clients,0);
  }
});

async function digest(db) {
  const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result = {};
  for (const {tablename} of tables) {
    assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);
    const rows=await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS value FROM "${tablename}" t ORDER BY row_to_json(t)::text`);
    result[tablename]=createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  return result;
}

test("PostgreSQL16 shopper savings reads exact personal receipts without changing any table", {
  skip: !requested && "Requires the owned savings loopback or GitHub-hosted wallet PostgreSQL16 fixture."
}, async t => {
  const {db,target}=await openSavingsDatabase(process.env);
  try {
    // Earlier CI wallet suites retain their immutable synthetic history. The
    // new shopper identities below isolate totals; the digest protects all rows.
    if (target.mode === "LOCAL") assert.equal(await db.rewardClaim.count(),0,"Only a new synthetic local database is allowed");
    const f=await fixture(db), stranger=await shopperFixture(db);
    const current=()=>NOW;
    const service=(shopper=f.shopper, env=ENV)=>createShopperSavingsService({db,env,clock:current,
      loadShopper:tx=>requireRewardShopperAccess({db:tx,env,token:shopper.token,clock:current})});
    const receipt=async (merchant, shopper, patch={})=>{
      const claim=await rawClaim(db,merchant,{shopper});
      return db.rewardRedemption.create({data:{organisationId:merchant.organisation.id,offerId:merchant.offer.id,
        shopperId:shopper.shopper.id,locationId:claim.locationId,claimId:claim.id,actorUserId:merchant.user.id,
        actorOrganisationMemberId:merchant.member.id,idempotencyKeyHash:randomBytes(32).toString("hex"),requestHash:randomBytes(32).toString("hex"),
        eligibleSpendMinor:10000,currency:"EUR",discountMinor:1000,occurredAt:NOW,...patch}});
    };
    await receipt(f,f.shopper);
    await receipt(f,stranger,{discountMinor:9000});
    await rawClaim(db,f); // An unused claim must never contribute a saving.
    const corrected=await receipt(f,f.shopper,{discountMinor:700}); await rawReversal(db,f,corrected);
    const other=await fixture(db); await receipt(other,f.shopper,{discountMinor:1500});
    const dollar={...f,...await newOffer(db,f,{currency:"USD"})}; await receipt(dollar,f.shopper,{currency:"USD",discountMinor:300});
    const unknown={...f,...await newOffer(db,f,{type:"BOGO",percentBps:null,buyQuantity:1,getQuantity:1})};
    await receipt(unknown,f.shopper,{discountMinor:null});
    const future={...f,...await newOffer(db,f)}; await receipt(future,f.shopper,{discountMinor:800,occurredAt:new Date(NOW.getTime()+hour)});
    const before=await digest(db);
    await t.test("own receipts across merchants are counted; another shopper, unused claims, future receipts and corrections are excluded",async()=>{
      const result=ok(await service().inspect());
      assert.equal(result.paymentEvidence,"UNAVAILABLE");
      assert.deepEqual(result.currencies,[{currency:"EUR",couponSavingsMinor:2500,valuedRedemptions:2,unvaluedRedemptions:1,subscriptionPaidMinor:null,netBenefitMinor:null},
        {currency:"USD",couponSavingsMinor:300,valuedRedemptions:1,unvaluedRedemptions:0,subscriptionPaidMinor:null,netBenefitMinor:null}]);
      assert.equal(result.checkedAt,NOW.toISOString());
      assert.deepEqual(ok(await service(stranger).inspect()).currencies,[{currency:"EUR",couponSavingsMinor:9000,valuedRedemptions:1,unvaluedRedemptions:0,subscriptionPaidMinor:null,netBenefitMinor:null}]);
      const text=JSON.stringify(result);
      for(const secret of [f.organisation.id,f.shopper.shopper.id,f.shopper.token,stranger.shopper.id,corrected.id,"PRIVATE"]) assert.ok(!text.includes(secret));
    });
    await t.test("closed Rewards and invalid shopper sessions expose no totals",async()=>{
      assert.equal((await service(f.shopper,{...ENV,RUVANAS_RETAIL_REWARDS_ENABLED:"false"}).inspect()).ok,false);
      assert.equal((await service({...f.shopper,token:"ff".repeat(32)}).inspect()).ok,false);
    });
    await t.test("all business and shopper table digests remain unchanged after savings reads",async()=>{
      assert.deepEqual(await digest(db),before);
    });
    await t.test("revoking shopper access prevents a subsequent snapshot",async()=>{
      await db.rewardShopperSession.update({where:{id:f.shopper.session.id},data:{revokedAt:NOW}});
      assert.equal((await service().inspect()).ok,false);
    });
  } finally { await db.$disconnect(); }
});
