-- RR-06b LOCAL CANDIDATE. Additive optional draft/revision metadata only.
-- No backfill, grant, coupon publication, audio, billing or activation changes.
-- Keep these tables and their immutable history on application rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TYPE "RewardAuditAction" ADD VALUE 'OFFER_CAMPAIGN_DRAFT_SAVED';
ALTER TYPE "RewardAuditAction" ADD VALUE 'OFFER_CAMPAIGN_DRAFT_CLEARED';
CREATE UNIQUE INDEX "Campaign_id_organisationId_key" ON "Campaign"("id", "organisationId");

-- Only this bounded, non-secret association snapshot is accepted. It is not
-- placed into shopper-visible terms and is not evidence of audio delivery.
CREATE FUNCTION "ruvanas_rewards_campaign_snapshot_valid"(snapshot JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  key_count INTEGER;
  entry JSONB;
  instant TIMESTAMPTZ;
  first_day DATE;
  last_day DATE;
BEGIN
  IF jsonb_typeof(snapshot) <> 'object' OR octet_length(snapshot::text) > 32768 THEN RETURN false; END IF;
  SELECT count(*) INTO key_count FROM jsonb_object_keys(snapshot);
  IF key_count <> 7 OR NOT snapshot ?& ARRAY['schemaVersion','campaignName','promoName','publishedAt','startsOn','endsOn','locationIds']
    OR snapshot -> 'schemaVersion' <> '1'::jsonb THEN RETURN false; END IF;
  IF jsonb_typeof(snapshot -> 'campaignName') <> 'string' OR char_length(snapshot ->> 'campaignName') NOT BETWEEN 1 AND 500
    OR jsonb_typeof(snapshot -> 'promoName') <> 'string' OR char_length(snapshot ->> 'promoName') NOT BETWEEN 1 AND 500
    OR jsonb_typeof(snapshot -> 'publishedAt') <> 'string' OR (snapshot ->> 'publishedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    OR jsonb_typeof(snapshot -> 'startsOn') <> 'string' OR (snapshot ->> 'startsOn') !~ '^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(snapshot -> 'endsOn') <> 'string' OR (snapshot ->> 'endsOn') !~ '^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(snapshot -> 'locationIds') <> 'array' THEN RETURN false; END IF;
  instant := (snapshot ->> 'publishedAt')::timestamptz;
  first_day := (snapshot ->> 'startsOn')::date;
  last_day := (snapshot ->> 'endsOn')::date;
  IF NOT isfinite(instant) OR NOT isfinite(first_day) OR NOT isfinite(last_day)
    OR to_char(instant AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> snapshot ->> 'publishedAt'
    OR to_char(first_day, 'YYYY-MM-DD') <> snapshot ->> 'startsOn'
    OR to_char(last_day, 'YYYY-MM-DD') <> snapshot ->> 'endsOn' OR first_day > last_day THEN RETURN false; END IF;
  IF jsonb_array_length(snapshot -> 'locationIds') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(snapshot -> 'locationIds') LOOP
    IF jsonb_typeof(entry) <> 'string' OR NOT "ruvanas_rewards_identifier_valid"(entry #>> '{}') THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(snapshot -> 'locationIds')) <> jsonb_array_length(snapshot -> 'locationIds') THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE TABLE "RewardOfferCampaignDraft" (
  "offerId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignPublicationRevision" INTEGER NOT NULL,
  "campaignConfigurationHash" VARCHAR(64) NOT NULL,
  "selectedByUserId" VARCHAR(191) NOT NULL,
  "selectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardOfferCampaignDraft_pkey" PRIMARY KEY ("offerId"),
  CONSTRAINT "RewardOfferCampaignDraft_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("offerId") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("campaignId") AND "ruvanas_rewards_identifier_valid"("selectedByUserId")),
  CONSTRAINT "RewardOfferCampaignDraft_revision_check" CHECK ("campaignPublicationRevision" >= 1),
  CONSTRAINT "RewardOfferCampaignDraft_hash_check" CHECK ("campaignConfigurationHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "RewardOfferCampaignDraft_time_check" CHECK (isfinite("selectedAt"))
);
CREATE UNIQUE INDEX "RewardOfferCampaignDraft_offerId_organisationId_key" ON "RewardOfferCampaignDraft"("offerId", "organisationId");
CREATE INDEX "RewardOfferCampaignDraft_organisationId_campaignId_idx" ON "RewardOfferCampaignDraft"("organisationId", "campaignId");
ALTER TABLE "RewardOfferCampaignDraft" ADD CONSTRAINT "RewardOfferCampaignDraft_offerId_organisationId_fkey"
  FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOffer"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOfferCampaignDraft" ADD CONSTRAINT "RewardOfferCampaignDraft_campaignId_organisationId_fkey"
  FOREIGN KEY ("campaignId", "organisationId") REFERENCES "Campaign"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "ruvanas_rewards_campaign_draft_identity_fixed"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."offerId" IS DISTINCT FROM OLD."offerId" OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId" THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A Rewards campaign draft cannot change its coupon or organisation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RewardOfferCampaignDraft_identity_fixed" BEFORE UPDATE ON "RewardOfferCampaignDraft"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_rewards_campaign_draft_identity_fixed"();

CREATE TABLE "RewardOfferCampaignRevision" (
  "offerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "organisationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignPublicationRevision" INTEGER NOT NULL,
  "campaignConfigurationHash" VARCHAR(64) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "actorUserId" VARCHAR(191) NOT NULL,
  "pinnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardOfferCampaignRevision_pkey" PRIMARY KEY ("offerId", "revision"),
  CONSTRAINT "RewardOfferCampaignRevision_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("offerId") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("campaignId") AND "ruvanas_rewards_identifier_valid"("actorUserId")),
  CONSTRAINT "RewardOfferCampaignRevision_revision_check" CHECK ("revision" >= 1 AND "campaignPublicationRevision" >= 1),
  CONSTRAINT "RewardOfferCampaignRevision_hash_check" CHECK ("campaignConfigurationHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "RewardOfferCampaignRevision_snapshot_check" CHECK ("ruvanas_rewards_campaign_snapshot_valid"("snapshot")),
  CONSTRAINT "RewardOfferCampaignRevision_time_check" CHECK (isfinite("pinnedAt"))
);
CREATE UNIQUE INDEX "RewardCampaignRevision_tenant_revision_key" ON "RewardOfferCampaignRevision"("offerId", "revision", "organisationId");
CREATE INDEX "RewardCampaignRevision_campaign_revision_idx" ON "RewardOfferCampaignRevision"("organisationId", "campaignId", "campaignPublicationRevision");
ALTER TABLE "RewardOfferCampaignRevision" ADD CONSTRAINT "RewardCampaignRevision_offer_tenant_fk"
  FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOffer"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOfferCampaignRevision" ADD CONSTRAINT "RewardCampaignRevision_offer_revision_tenant_fk"
  FOREIGN KEY ("offerId", "revision", "organisationId") REFERENCES "RewardOfferRevision"("offerId", "revision", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOfferCampaignRevision" ADD CONSTRAINT "RewardCampaignRevision_campaign_tenant_fk"
  FOREIGN KEY ("campaignId", "organisationId") REFERENCES "Campaign"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A late insert against an old revision would retroactively associate existing
-- claims. Require the new revision and link in the same top-level transaction.
-- A publication must not insert its revision inside a SAVEPOINT subtransaction.
-- Existing old application versions can continue publishing unlinked revisions.
CREATE FUNCTION "ruvanas_rewards_campaign_pin_new_revision_only"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_revision RECORD;
BEGIN
  SELECT r.xmin AS inserted_by, r."terms" INTO current_revision FROM "RewardOfferRevision" r
    WHERE r."offerId" = NEW."offerId" AND r."revision" = NEW."revision" AND r."organisationId" = NEW."organisationId";
  -- xmin stores the low32 bits; current_xact_id includes the wraparound epoch.
  IF NOT FOUND OR current_revision.inserted_by <> mod(pg_current_xact_id()::text::numeric, 4294967296)::text::xid THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A Rewards campaign can be pinned only to a new coupon revision';
  END IF;
  IF NOT "ruvanas_rewards_campaign_snapshot_valid"(NEW."snapshot") OR
    jsonb_typeof(current_revision."terms" -> 'locationIds') IS DISTINCT FROM 'array' OR
    NOT ((current_revision."terms" -> 'locationIds') @> (NEW."snapshot" -> 'locationIds') AND
      (NEW."snapshot" -> 'locationIds') @> (current_revision."terms" -> 'locationIds')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A Rewards campaign snapshot must cover exactly the new coupon shops';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "RewardOfferCampaignDraft" d
    WHERE d."offerId" = NEW."offerId" AND d."organisationId" = NEW."organisationId" AND d."campaignId" = NEW."campaignId"
      AND d."campaignPublicationRevision" = NEW."campaignPublicationRevision" AND d."campaignConfigurationHash" = NEW."campaignConfigurationHash") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A Rewards campaign pin must match the saved draft selection';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RewardOfferCampaignRevision_new_revision_only" BEFORE INSERT ON "RewardOfferCampaignRevision"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_rewards_campaign_pin_new_revision_only"();
CREATE TRIGGER "RewardOfferCampaignRevision_immutable" BEFORE UPDATE OR DELETE ON "RewardOfferCampaignRevision"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_revision_mutation"();
CREATE TRIGGER "RewardOfferCampaignRevision_no_truncate" BEFORE TRUNCATE ON "RewardOfferCampaignRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_revision_mutation"();

-- Rollback to an older application must not silently publish an unlinked
-- revision while a saved selection is present. The new app inserts the pin
-- later in the same transaction, so validate this requirement at commit.
-- Older app publication without any saved selection remains compatible.
CREATE FUNCTION "ruvanas_rewards_campaign_pin_required"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RewardOfferCampaignDraft" d
    WHERE d."offerId" = NEW."offerId" AND d."organisationId" = NEW."organisationId"
      AND NOT EXISTS (SELECT 1 FROM "RewardOfferCampaignRevision" p
        WHERE p."offerId" = NEW."offerId" AND p."revision" = NEW."revision" AND p."organisationId" = NEW."organisationId"
          AND p."campaignId" = d."campaignId" AND p."campaignPublicationRevision" = d."campaignPublicationRevision"
          AND p."campaignConfigurationHash" = d."campaignConfigurationHash")) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A saved campaign selection must be pinned when publishing a new coupon revision';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "RewardOfferRevision_campaign_pin_required"
  AFTER INSERT ON "RewardOfferRevision" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_rewards_campaign_pin_required"();

-- Text casts permit the new enum labels in this migration transaction. Preserve
-- all earlier audit action/target combinations and the existing metadata gate.
ALTER TABLE "RewardAuditEvent" DROP CONSTRAINT "RewardAuditEvent_target_check";
ALTER TABLE "RewardAuditEvent" ADD CONSTRAINT "RewardAuditEvent_target_check" CHECK (
  ("targetType"::text = 'PROGRAM' AND "action"::text IN ('PROGRAM_CREATED', 'PROGRAM_CHANGED')) OR
  ("targetType"::text = 'ENTITLEMENT_GRANT' AND "action"::text IN ('ENTITLEMENT_CREATED', 'ENTITLEMENT_CHANGED', 'ENTITLEMENT_REVOKED')) OR
  ("targetType"::text = 'STAFF_GRANT' AND "action"::text IN ('STAFF_GRANT_CREATED', 'STAFF_GRANT_CHANGED', 'STAFF_GRANT_REVOKED')) OR
  ("targetType"::text = 'OFFER' AND "action"::text IN ('OFFER_CREATED', 'OFFER_DRAFT_SAVED', 'OFFER_PUBLISHED', 'OFFER_PAUSED',
    'OFFER_RESUMED', 'OFFER_CANCELLED', 'OFFER_CAMPAIGN_DRAFT_SAVED', 'OFFER_CAMPAIGN_DRAFT_CLEARED')));

COMMIT;
