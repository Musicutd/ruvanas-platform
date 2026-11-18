import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const CLUSTER = /\/retail-rewards-rr06b-20261114\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/;
const DATABASE = /^ruvanas_rewards_campaign_link(?:_routes|_upgrade|_full)?$/;
const rollback = new Error("ROLL_BACK_OWNED_RR06B_SCHEMA_CHECKS");

// The external acceptance harness owns/creates/stops the disposable cluster.
// This additional check runs before any fixture write, even for direct callers.
export async function assertCampaignLinksDatabaseIdentity(db) {
  const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.match(row.directory.replaceAll("\\", "/"), CLUSTER);
  assert.match(row.database, DATABASE);
  assert.equal(row.role, "rr06b_qa"); assert.equal(row.host, "127.0.0.1");
  assert.ok(Number.isInteger(row.port) && row.port > 1024 && row.port <= 65535);
  return row;
}

test("RR06b schema acceptance refuses a shared/remote database before fixture writes", async () => {
  const valid = { directory: "C:/synthetic/output/retail-rewards-rr06b-20261114/sessions/postgres-123456-abcdef0123/postgres",
    database: "ruvanas_rewards_campaign_link_routes", role: "rr06b_qa", host: "127.0.0.1", port: 54222 };
  for (const patch of [{ directory: "C:/production/data" }, { database: "ruvanas" }, { role: "postgres" },
    { host: "203.0.113.4" }, { port: 543 }, { port: 99999 }]) {
    let writes = 0, reads = 0;
    const db = { $queryRawUnsafe: async () => { reads++; return [{ ...valid, ...patch }]; },
      $transaction: () => { writes++; throw new Error("No writes permitted"); } };
    await assert.rejects(runCampaignLinkSqlChecks({ db }));
    assert.equal(reads, 1); assert.equal(writes, 0);
  }
  assert.deepEqual(await assertCampaignLinksDatabaseIdentity({ $queryRawUnsafe: async () => [valid] }), valid);
});

async function rejectsSql(tx, query, params, expected) {
  await tx.$executeRawUnsafe("SAVEPOINT rr06b_rejected_write");
  let failure;
  try { await tx.$executeRawUnsafe(query, ...params); } catch (error) { failure = error; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rr06b_rejected_write");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT rr06b_rejected_write");
  assert.ok(failure, "PostgreSQL accepted a forbidden association write");
  assert.ok([expected].flat().includes(failure.meta?.code), `Unexpected SQL state: ${failure.meta?.code}`);
}

const pinSql = `INSERT INTO "RewardOfferCampaignRevision" ("offerId","revision","organisationId","campaignId",
  "campaignPublicationRevision","campaignConfigurationHash","snapshot","actorUserId") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`;

/** Call only from the owned RR06b PostgreSQL harness after applying migration140.
 * Required fixture: a previously COMMITTED offer revision (oldRevision), same
 * and foreign tenant campaigns, actor and canonical snapshot matching offer
 * terms. All new rows are cloned into one rollback transaction. No source
 * campaign, claim, audio or existing offer row is changed.
 */
export async function runCampaignLinkSqlChecks({ db, organisationId, otherOrganisationId, offerId, oldRevision = 1,
  newRevision = 1, campaignId, foreignCampaignId, actorUserId, snapshot }) {
  await assertCampaignLinksDatabaseIdentity(db);
  const original = await db.rewardOffer.findUnique({ where: { id: offerId } });
  assert.equal(original?.organisationId, organisationId);
  const priorRevision = await db.rewardOfferRevision.findUnique({ where: { offerId_revision: { offerId, revision: oldRevision } } });
  assert.equal(priorRevision?.organisationId, organisationId);
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  const foreignCampaign = await db.campaign.findUnique({ where: { id: foreignCampaignId } });
  assert.equal(campaign?.organisationId, organisationId);
  assert.equal(foreignCampaign?.organisationId, otherOrganisationId);
  assert.notEqual(organisationId, otherOrganisationId);
  assert.equal(typeof actorUserId, "string");
  assert.ok(Number.isInteger(newRevision) && newRevision >= 1);
  const before = await db.$queryRawUnsafe(`SELECT jsonb_build_object(
    'drafts',(SELECT count(*) FROM "RewardOfferCampaignDraft"),
    'links',(SELECT count(*) FROM "RewardOfferCampaignRevision"),
    'offers',(SELECT count(*) FROM "RewardOffer"),
    'revisions',(SELECT count(*) FROM "RewardOfferRevision"),
    'claims',(SELECT count(*) FROM "RewardClaim"),
    'redemptions',(SELECT count(*) FROM "RewardRedemption"),
    'audit',(SELECT count(*) FROM "RewardAuditEvent")) AS state`);
  const checks = [];
  // A real commit attempt (not a regex/schema assertion) models the old app:
  // the draft selection exists but it does not know to create the new pin.
  const refusedOfferId = `rr06b-no-pin-${randomUUID()}`;
  let missingPinFailure;
  try {
    await db.$transaction(async tx => {
      await tx.rewardOffer.create({ data: { id: refusedOfferId, organisationId, programId: original.programId,
        draft: priorRevision.terms, createdByUserId: actorUserId, updatedByUserId: actorUserId } });
      await tx.rewardOfferCampaignDraft.create({ data: { offerId: refusedOfferId, organisationId, campaignId,
        campaignPublicationRevision: campaign.publicationRevision, campaignConfigurationHash: campaign.publishedConfigurationHash,
        selectedByUserId: actorUserId } });
      await tx.rewardOfferRevision.create({ data: { organisationId, offerId: refusedOfferId,
        revision: newRevision, terms: priorRevision.terms, actorUserId } });
    });
  } catch (error) { missingPinFailure = error; }
  assert.ok(missingPinFailure, "Old-style publication silently omitted the saved campaign pin");
  assert.match(`${missingPinFailure.message} ${JSON.stringify(missingPinFailure.meta ?? {})}`,
    /saved campaign selection must be pinned/i, "The transaction must fail specifically on the deferred pin constraint");
  assert.equal(await db.rewardOffer.findUnique({ where: { id: refusedOfferId } }), null,
    "A rejected deferred constraint must roll back the entire publication");
  checks.push("Commit rejects old-app publication that omits a saved campaign selection");
  try {
    await db.$transaction(async tx => {
      const params = (targetOffer, revision, patch = {}) => [targetOffer, revision, organisationId,
        patch.campaignId ?? campaignId, campaign.publicationRevision, patch.hash ?? campaign.publishedConfigurationHash,
        JSON.stringify(patch.snapshot ?? snapshot), actorUserId];
      await rejectsSql(tx, pinSql, params(offerId, oldRevision), "55000");
      checks.push("Committed coupon revisions reject retroactive campaign association");

      const [{ valid }] = await tx.$queryRawUnsafe('SELECT "ruvanas_rewards_campaign_snapshot_valid"($1::jsonb) AS valid', JSON.stringify(snapshot));
      assert.equal(valid, true);
      for (const patch of [null, [], { ...snapshot, sourceUrl: "https://example.invalid/private" },
        { ...snapshot, schemaVersion: 2 }, { ...snapshot, campaignName: "" }, { ...snapshot, promoName: "x".repeat(501) },
        { ...snapshot, publishedAt: "2026-11-14T12:00:00Z" }, { ...snapshot, startsOn: "2026-02-30" },
        { ...snapshot, startsOn: "2028-01-01", endsOn: "2027-01-01" }, { ...snapshot, locationIds: [] },
        { ...snapshot, locationIds: [snapshot.locationIds[0], snapshot.locationIds[0]] },
        { ...snapshot, locationIds: [null] }, { ...snapshot, locationIds: ["foreign/shop"] },
        { ...snapshot, locationIds: Array.from({ length: 101 }, (_, i) => `shop-${i}`) }]) {
        const result = await tx.$queryRawUnsafe('SELECT "ruvanas_rewards_campaign_snapshot_valid"($1::jsonb) AS valid', JSON.stringify(patch));
        assert.equal(result[0].valid, false);
      }
      checks.push("Strict safe snapshot rejects extra data, malformed dates and invalid shop sets");

      const clone = await tx.rewardOffer.create({ data: { id: `rr06b-schema-${randomUUID()}`, organisationId,
        programId: original.programId, draft: priorRevision.terms, createdByUserId: actorUserId, updatedByUserId: actorUserId } });
      const draftSql = `INSERT INTO "RewardOfferCampaignDraft" ("offerId","organisationId","campaignId",
        "campaignPublicationRevision","campaignConfigurationHash","selectedByUserId") VALUES ($1,$2,$3,$4,$5,$6)`;
      const draftParams = [clone.id, organisationId, campaignId, campaign.publicationRevision, campaign.publishedConfigurationHash, actorUserId];
      await rejectsSql(tx, draftSql, [clone.id, organisationId, foreignCampaignId, ...draftParams.slice(3)], "23503");
      await rejectsSql(tx, draftSql, [clone.id, otherOrganisationId, foreignCampaignId, ...draftParams.slice(3)], "23503");
      await rejectsSql(tx, draftSql, [clone.id, organisationId, campaignId, 0, ...draftParams.slice(4)], "23514");
      await tx.$executeRawUnsafe(draftSql, ...draftParams);
      await rejectsSql(tx, 'UPDATE "RewardOfferCampaignDraft" SET "organisationId"=$1 WHERE "offerId"=$2', [otherOrganisationId, clone.id], "55000");
      await rejectsSql(tx, 'UPDATE "RewardOfferCampaignDraft" SET "offerId"=$1 WHERE "offerId"=$2', [offerId, clone.id], "55000");
      await rejectsSql(tx, 'UPDATE "RewardOfferCampaignDraft" SET "campaignId"=$1 WHERE "offerId"=$2', [foreignCampaignId, clone.id], "23503");
      await rejectsSql(tx, 'UPDATE "RewardOfferCampaignDraft" SET "campaignConfigurationHash"=$1 WHERE "offerId"=$2', ["invalid", clone.id], "23514");
      await rejectsSql(tx, 'UPDATE "RewardOfferCampaignDraft" SET "selectedAt"=\'infinity\' WHERE "offerId"=$1', [clone.id], "23514");
      checks.push("Draft ownership and campaign foreign keys enforce tenant isolation");

      const revision = await tx.rewardOfferRevision.create({ data: { organisationId, offerId: clone.id,
        revision: newRevision, terms: priorRevision.terms, actorUserId } });
      assert.equal(revision.revision, newRevision);
      // Draft FKs above already reject a foreign campaign. Pinning also requires
      // the exact saved selection, and that trigger rejects this before its FK.
      await rejectsSql(tx, pinSql, params(clone.id, newRevision, { campaignId: foreignCampaignId }), "23514");
      await rejectsSql(tx, pinSql, params(clone.id, newRevision, { snapshot: { ...snapshot, locationIds: ["foreign-shop"] } }), "23514");
      await rejectsSql(tx, pinSql, params(clone.id, newRevision, { hash: "invalid" }), "23514");
      await tx.$executeRawUnsafe(pinSql, ...params(clone.id, newRevision));
      const pinned = await tx.rewardOfferCampaignRevision.findUnique({ where: { offerId_revision: { offerId: clone.id, revision: newRevision } } });
      assert.deepEqual(pinned.snapshot, snapshot);
      assert.deepEqual((await tx.rewardOfferRevision.findUnique({ where: { id: revision.id } })).terms, priorRevision.terms);
      checks.push("New revision pins exactly one same-tenant campaign without changing coupon terms");

      await rejectsSql(tx, pinSql, params(clone.id, newRevision), "23505");
      await rejectsSql(tx, 'UPDATE "RewardOfferCampaignRevision" SET "snapshot"=$1::jsonb WHERE "offerId"=$2', [JSON.stringify(snapshot), clone.id], "55000");
      await rejectsSql(tx, 'DELETE FROM "RewardOfferCampaignRevision" WHERE "offerId"=$1', [clone.id], "55000");
      await rejectsSql(tx, 'TRUNCATE TABLE "RewardOfferCampaignRevision"', [], "55000");
      await rejectsSql(tx, 'DELETE FROM "Campaign" WHERE "id"=$1', [campaignId], ["23001", "23503"]);
      checks.push("Pinned history rejects mutation, deletion, duplicate pins and campaign deletion");

      await tx.rewardOfferCampaignDraft.delete({ where: { offerId: clone.id } });
      assert.deepEqual(await tx.rewardOfferCampaignRevision.findUnique({ where: { offerId_revision: { offerId: clone.id, revision: newRevision } } }), pinned);
      await tx.rewardOfferRevision.create({ data: { organisationId, offerId: clone.id,
        revision: newRevision + 1, terms: priorRevision.terms, actorUserId } });
      await rejectsSql(tx, pinSql, params(clone.id, newRevision + 1), "23514");
      assert.equal(await tx.rewardOfferCampaignRevision.count({ where: { offerId: clone.id } }), 1);
      checks.push("Clearing the draft preserves old history and permits an unlinked new revision");

      for (const action of ["OFFER_CAMPAIGN_DRAFT_SAVED", "OFFER_CAMPAIGN_DRAFT_CLEARED"]) {
        await tx.rewardAuditEvent.create({ data: { organisationId, actorUserId, action, targetType: "OFFER",
          targetId: clone.id, metadata: { reasonCode: "OWNER_REQUEST", version: 2 } } });
        await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId",action,"targetType","targetId",metadata) VALUES ($1,$2,$3::"RewardAuditAction",\'PROGRAM\',$4,\'{}\'::jsonb)',
          [randomUUID(), organisationId, action, clone.id], "23514");
        await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId",action,"targetType","targetId",metadata) VALUES ($1,$2,$3::"RewardAuditAction",\'OFFER\',$4,$5::jsonb)',
          [randomUUID(), organisationId, action, clone.id, JSON.stringify({ campaignName: "Private campaign" })], "23514");
      }
      checks.push("New draft audit actions retain the existing safe metadata and target gates");
      throw rollback;
    }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 120000 });
    assert.fail("Synthetic schema fixture must roll back");
  } catch (error) { if (error !== rollback) throw error; }
  const after = await db.$queryRawUnsafe(`SELECT jsonb_build_object(
    'drafts',(SELECT count(*) FROM "RewardOfferCampaignDraft"),
    'links',(SELECT count(*) FROM "RewardOfferCampaignRevision"),
    'offers',(SELECT count(*) FROM "RewardOffer"),
    'revisions',(SELECT count(*) FROM "RewardOfferRevision"),
    'claims',(SELECT count(*) FROM "RewardClaim"),
    'redemptions',(SELECT count(*) FROM "RewardRedemption"),
    'audit',(SELECT count(*) FROM "RewardAuditEvent")) AS state`);
  assert.deepEqual(after, before);
  assert.deepEqual(await db.rewardOffer.findUnique({ where: { id: offerId } }), original);
  assert.deepEqual(await db.campaign.findUnique({ where: { id: campaignId } }), campaign);
  checks.push("Rollback preserves pre-existing coupons, campaigns, claims and audit counts");
  return { checks, count: checks.length, allPassed: true, sourceDataUnchanged: true };
}
