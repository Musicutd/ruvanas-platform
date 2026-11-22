import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { createShopperSavedWalletService } from "../lib/retail-rewards/shopper-saved-wallet-service.mjs";
import { createShopperSavingsService } from "../lib/retail-rewards/shopper-savings-service.mjs";
import { requireRewardShopperAccess } from "../lib/retail-rewards/shopper-access.mjs";
import { savedWalletDatabaseTarget, openSavedWalletDatabase, fixture, shopperFixture, newOffer, rawClaim, rawReceipt, ENV, NOW } from "./fixtures/shopper-saved-wallet-database.mjs";
const requested = process.env.RUVANAS_REWARDS_SAVED_WALLET_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const END = new Date("2027-11-14T12:00:00.000Z");
const ok = result => { assert.equal(result?.ok,true,`Expected success: ${JSON.stringify(result)}`); return result; };
const denied = result => { assert.equal(result?.ok,false,"Unexpected authorization success"); return result; };

test("saved-wallet database guard rejects any unowned target before a client is opened", async () => {
  const cluster = path.resolve("output/retail-rewards-connected-wallet-20261122/sessions/postgres-123-1234567890/postgres");
  const url = "postgresql://saved_wallet_qa@127.0.0.1:54433/ruvanas_rewards_saved_wallet?connection_limit=6";
  const env = { RUN_DATABASE_TESTS:"1", RUVANAS_REWARDS_SAVED_WALLET_LOCAL_TEST:"1", DATABASE_URL:url, RUVANAS_REWARDS_DATABASE_URL:url, RUVANAS_REWARDS_CLUSTER_DIR:cluster };
  assert.equal(savedWalletDatabaseTarget(env,{realpath:value=>value}).mode,"LOCAL");
  for (const patch of [{RUN_DATABASE_TESTS:"0"},{RUVANAS_REWARDS_SAVED_WALLET_LOCAL_TEST:"true"},{RUVANAS_REWARDS_CI_TEST:"1"},
    {DATABASE_URL:undefined},{RUVANAS_REWARDS_CLUSTER_DIR:path.resolve("unknown")},
    {RUVANAS_REWARDS_DATABASE_URL:url.replace("127.0.0.1","production.invalid")},{RUVANAS_REWARDS_DATABASE_URL:url.replace("saved_wallet_qa","postgres")}]) {
    let clients=0;
    await assert.rejects(openSavedWalletDatabase({...env,...patch},{realpath:value=>value,createClient:()=>{clients++;}}));
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


test("PostgreSQL16 saved wallet persists per-shopper favourites without issuing or redeeming vouchers", {
  skip: !requested && "Requires the owned saved-wallet loopback or GitHub-hosted wallet PostgreSQL16 fixture."
}, async t => {
  let {db,target}=await openSavedWalletDatabase(process.env);
  try {
    assert.equal(await db.rewardSavedVoucher.count(),0,"Only a new synthetic database is allowed");
    // The CI job retains the preceding wallet-usage suite's immutable history.
    // All test actions below use newly created synthetic shoppers and offers.
    if (target.mode === "LOCAL") assert.equal(await db.rewardClaim.count(),0,"Only a new synthetic local database is allowed");
    const f=await fixture(db), stranger=await shopperFixture(db), other=await fixture(db);
    const clock=()=>NOW;
    const service=(shopper=f.shopper,env=ENV)=>createShopperSavedWalletService({db,env,clock,
      loadShopper:tx=>requireRewardShopperAccess({db:tx,env,token:shopper.token,clock})});
    const savings=()=>createShopperSavingsService({db,env:ENV,clock,
      loadShopper:tx=>requireRewardShopperAccess({db:tx,env:ENV,token:f.shopper.token,clock})});
    const input={shopSlug:f.profile.publicSlug,offerSlug:f.listing.publicSlug};
    const foreign={shopSlug:other.profile.publicSlug,offerSlug:other.listing.publicSlug};
    const claim=await rawClaim(db,f);
    await rawReceipt(db,f,claim);
    const receiptSnapshot=ok(await savings().inspect());
    const before=await digest(db);
    let saved;
    await t.test("concurrent identical saves are idempotent and resolve the exact current shopper's remaining uses",async()=>{
      const results=await Promise.all(Array.from({length:4},()=>service().save(input)));
      for(const result of results)ok(result);
      saved=results[0].item;
      assert.equal(saved.status,"AVAILABLE");
      assert.equal(saved.offer.usage.remaining,9);
      assert.ok(results.every(result=>result.item.id===saved.id));
      assert.equal(await db.rewardSavedVoucher.count(),1);
      const list=ok(await service().list({page:1}));
      assert.equal(list.savedCount,1);
      assert.equal(list.items.length,1);
      assert.equal(list.items[0].id,saved.id);
      assert.equal(list.hasMore,false);
      assert.ok(!JSON.stringify(list).includes("PRIVATE"));
    });
    await t.test("saved favourites persist after reconnecting a Prisma client",async()=>{
      await db.$disconnect();
      ({db}=await openSavedWalletDatabase(process.env));
      const list=ok(await service().list());
      assert.equal(list.items[0].id,saved.id);
      assert.equal(list.items[0].offer.slug,f.listing.publicSlug);
    });
    await t.test("another shopper cannot read or remove a saved voucher belonging to the first shopper",async()=>{
      const strangerList=ok(await service(stranger).list());
      assert.equal(strangerList.savedCount,0);
      assert.deepEqual(strangerList.items,[]);
      assert.equal(ok(await service(stranger).status({offers:[input]})).items[0].savedId,null);
      const deletion=await service(stranger).remove(saved.id);
      assert.equal(await db.rewardSavedVoucher.count({where:{id:saved.id}}),1);
      assert.ok(deletion.ok===false || deletion.removed===true);
      const strangerSaved=ok(await service(stranger).save(input)).item;
      assert.notEqual(strangerSaved.id,saved.id);
      assert.equal(strangerSaved.offer.usage.remaining,10);
      assert.equal(ok(await service().status({offers:[input,foreign]})).items[0].savedId,saved.id);
      assert.equal(ok(await service(stranger).status({offers:[input]})).items[0].savedId,strangerSaved.id);
    });
    await t.test("unrelated shop/offer pairs and caller-supplied shopper IDs cannot create favourites",async()=>{
      const count=await db.rewardSavedVoucher.count();
      denied(await service().save({shopSlug:f.profile.publicSlug,offerSlug:other.listing.publicSlug}));
      denied(await service().save({...input,shopperId:stranger.shopper.id}));
      assert.equal(await db.rewardSavedVoucher.count(),count);
    });
    await t.test("saving/removing favourites changes only the dedicated saved-voucher table",async()=>{
      const foreignSaved=ok(await service().save(foreign)).item;
      ok(await service().remove(foreignSaved.id));
      ok(await service().remove(foreignSaved.id));
      const after=await digest(db);
      delete before.RewardSavedVoucher; delete after.RewardSavedVoucher;
      assert.deepEqual(after,before);
      assert.deepEqual(ok(await savings().inspect()),receiptSnapshot);
    });
    await t.test("unpublished offers stay in the private wallet without exposing their withdrawn public details",async()=>{
      await db.rewardOffer.update({where:{id:f.offer.id},data:{state:"PAUSED"}});
      const list=ok(await service().list());
      const item=list.items.find(item=>item.id===saved.id);
      assert.deepEqual(Object.keys(item).sort(),["id","savedAt","status"]);
      assert.equal(item.status,"UNAVAILABLE");
      assert.equal(list.savedCount,1);
      denied(await service().save(input));
      assert.ok(!JSON.stringify(item).includes(f.profile.displayName));
      await db.rewardOffer.update({where:{id:f.offer.id},data:{state:"PUBLISHED"}});
      assert.equal(ok(await service().list()).items[0].status,"AVAILABLE");
    });
    await t.test("expired public terms are unavailable and may still be removed by their owner",async()=>{
      await db.rewardOffer.update({where:{id:f.offer.id},data:{publishedEndsAt:new Date(NOW.getTime()-1)}});
      const list=ok(await service().list());
      assert.equal(list.items[0].status,"UNAVAILABLE");
      assert.ok(!JSON.stringify(list.items[0]).includes(f.terms.title));
      denied(await service().save(input));
      ok(await service().remove(saved.id));
      assert.equal(ok(await service().list()).savedCount,0);
      await db.rewardOffer.update({where:{id:f.offer.id},data:{publishedEndsAt:END}});
    });
    await t.test("tenant keys in saved-voucher relationships cannot mix two merchants",async()=>{
      await assert.rejects(db.rewardSavedVoucher.create({data:{shopperId:f.shopper.shopper.id,
        shopProfileId:other.profile.id,offerId:f.offer.id,organisationId:f.organisation.id}}));
      assert.equal(await db.rewardSavedVoucher.count({where:{shopperId:f.shopper.shopper.id}}),0);
    });
    await t.test("a full wallet page stays scoped and paginates all saved offers without duplicates",async()=>{
      const owner=await shopperFixture(db), outsider=await shopperFixture(db);
      const ids=[];
      // Thirteen offers per merchant stay within each fixture's twenty-offer
      // grant. This shopper's wallet legitimately spans participating shops.
      for(const merchant of [f,other]) for(let index=0;index<13;index++) {
        const extra=await newOffer(db,merchant,{title:`Paged wallet voucher ${index+1}`});
        ids.push(ok(await service(owner).save({shopSlug:merchant.profile.publicSlug,offerSlug:extra.listing.publicSlug})).item.id);
      }
      const first=ok(await service(owner).list({page:1})),second=ok(await service(owner).list({page:2})),third=ok(await service(owner).list({page:3}));
      assert.equal(first.items.length,25); assert.equal(first.hasMore,true); assert.equal(first.savedCount,26);
      assert.equal(second.items.length,1); assert.equal(second.hasMore,false); assert.equal(second.savedCount,26);
      assert.equal(third.items.length,0); assert.equal(third.hasMore,false); assert.equal(third.savedCount,26);
      const displayed=[...first.items,...second.items];
      assert.deepEqual(displayed.map(item=>item.id).sort(),ids.sort());
      assert.ok(displayed.every(item=>item.status==="AVAILABLE"));
      const pairs=first.items.map(item=>({shopSlug:item.shop.slug,offerSlug:item.offer.slug}));
      assert.ok(ok(await service(owner).status({offers:pairs})).items.every(item=>item.savedId));
      assert.ok(ok(await service(outsider).status({offers:pairs})).items.every(item=>item.savedId===null));
      assert.deepEqual(ok(await service(outsider).list()).items,[]);
      assert.equal(await db.rewardClaim.count({where:{shopperId:owner.shopper.id}}),0);
      assert.equal(await db.rewardRedemption.count({where:{shopperId:owner.shopper.id}}),0);
    });
    await t.test("closed Rewards and revoked shopper sessions prevent wallet reads and writes",async()=>{
      const count=await db.rewardSavedVoucher.count();
      const closed=service(f.shopper,{...ENV,RUVANAS_RETAIL_REWARDS_ENABLED:"false"});
      denied(await closed.list()); denied(await closed.save(input)); denied(await closed.remove(saved.id));
      await db.rewardShopperSession.update({where:{id:f.shopper.session.id},data:{revokedAt:NOW}});
      denied(await service().list()); denied(await service().save(input)); denied(await service().status({offers:[input]}));
      assert.equal(await db.rewardSavedVoucher.count(),count);
    });
  } finally { await db.$disconnect(); }
});
