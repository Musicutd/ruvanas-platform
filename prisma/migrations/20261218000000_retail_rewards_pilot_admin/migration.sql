-- RR-07b LOCAL CANDIDATE. Additive provenance/audit only: no provisioning,
-- shopper adoption, activation, feature flags, subscription changes or backfill.
-- Retain these tables on application rollback. Immutable rows intentionally
-- block organisation reset; no exception or history-erasing cascade is allowed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "RewardPilotAuditAction" AS ENUM (
  'PROGRAM_PREPARED', 'SHOP_PUBLISHED', 'OFFER_APPROVED', 'SHOPPER_INVITED',
  'INVITATION_REISSUED', 'INVITATION_REVOKED');
CREATE TYPE "RewardPilotAuditTargetType" AS ENUM ('PROGRAM', 'SHOP', 'OFFER', 'SHOPPER');

-- Only short typed evidence is accepted. In particular, email addresses,
-- invitation tokens/hashes, passwords and arbitrary snapshots have no field.
CREATE FUNCTION "ruvanas_rewards_pilot_audit_metadata_valid"(metadata JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  entry RECORD;
  scalar TEXT;
  parsed_time TIMESTAMPTZ;
BEGIN
  IF jsonb_typeof(metadata) <> 'object' OR octet_length(metadata::text) > 1024 THEN RETURN false; END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(metadata) LOOP
    scalar := entry.value #>> '{}';
    CASE
      WHEN entry.key IN ('revision', 'limitsVersion') THEN
        IF jsonb_typeof(entry.value) <> 'number' OR scalar::numeric < 1 OR
          scalar::numeric > 2147483647 OR mod(scalar::numeric, 1) <> 0 THEN RETURN false; END IF;
      WHEN entry.key = 'expiresAt' THEN
        IF jsonb_typeof(entry.value) <> 'string' OR
          scalar !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN RETURN false; END IF;
        parsed_time := scalar::timestamptz;
        IF NOT isfinite(parsed_time) OR
          to_char(parsed_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> scalar THEN RETURN false; END IF;
      WHEN entry.key = 'status' THEN
        IF jsonb_typeof(entry.value) <> 'string' OR scalar NOT IN
          ('PREPARED', 'PUBLISHED', 'APPROVED', 'INVITED', 'REISSUED', 'REVOKED') THEN RETURN false; END IF;
      ELSE RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE TABLE "RewardPilotShopperEnrollment" (
  "shopperId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "createdByUserId" VARCHAR(191) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardPilotShopperEnrollment_pkey" PRIMARY KEY ("shopperId"),
  CONSTRAINT "RewardPilotEnrollment_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("shopperId") AND
    "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("createdByUserId")),
  CONSTRAINT "RewardPilotEnrollment_timestamp_check" CHECK (isfinite("createdAt"))
);

CREATE TABLE "RewardPilotAuditEvent" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "actorUserId" VARCHAR(191) NOT NULL,
  "action" "RewardPilotAuditAction" NOT NULL,
  "targetType" "RewardPilotAuditTargetType" NOT NULL,
  "targetId" VARCHAR(191) NOT NULL,
  "requestId" VARCHAR(191),
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardPilotAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardPilotAuditEvent_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND
    "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("actorUserId") AND
    "ruvanas_rewards_identifier_valid"("targetId") AND
    ("requestId" IS NULL OR "ruvanas_rewards_identifier_valid"("requestId"))),
  CONSTRAINT "RewardPilotAuditEvent_target_check" CHECK (
    ("targetType" = 'PROGRAM' AND "action" = 'PROGRAM_PREPARED') OR
    ("targetType" = 'SHOP' AND "action" = 'SHOP_PUBLISHED') OR
    ("targetType" = 'OFFER' AND "action" = 'OFFER_APPROVED') OR
    ("targetType" = 'SHOPPER' AND "action" IN ('SHOPPER_INVITED', 'INVITATION_REISSUED', 'INVITATION_REVOKED'))),
  CONSTRAINT "RewardPilotAuditEvent_metadata_check" CHECK ("ruvanas_rewards_pilot_audit_metadata_valid"("metadataJson")),
  CONSTRAINT "RewardPilotAuditEvent_timestamp_check" CHECK (isfinite("createdAt"))
);

CREATE INDEX "RewardPilotEnrollment_org_time_idx" ON "RewardPilotShopperEnrollment"("organisationId", "createdAt");
CREATE INDEX "RewardPilotAuditEvent_org_time_idx" ON "RewardPilotAuditEvent"("organisationId", "createdAt", "id");
CREATE INDEX "RewardPilotAuditEvent_target_time_idx" ON "RewardPilotAuditEvent"("organisationId", "targetType", "targetId", "createdAt");

ALTER TABLE "RewardPilotShopperEnrollment" ADD CONSTRAINT "RewardPilotShopperEnrollment_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "RewardShopper"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardPilotShopperEnrollment" ADD CONSTRAINT "RewardPilotShopperEnrollment_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardPilotAuditEvent" ADD CONSTRAINT "RewardPilotAuditEvent_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "ruvanas_prevent_reward_pilot_evidence_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Rewards pilot evidence is immutable';
END;
$$;
CREATE TRIGGER "RewardPilotShopperEnrollment_immutable" BEFORE UPDATE OR DELETE ON "RewardPilotShopperEnrollment"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_pilot_evidence_mutation"();
CREATE TRIGGER "RewardPilotShopperEnrollment_no_truncate" BEFORE TRUNCATE ON "RewardPilotShopperEnrollment"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_pilot_evidence_mutation"();
CREATE TRIGGER "RewardPilotAuditEvent_immutable" BEFORE UPDATE OR DELETE ON "RewardPilotAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_pilot_evidence_mutation"();
CREATE TRIGGER "RewardPilotAuditEvent_no_truncate" BEFORE TRUNCATE ON "RewardPilotAuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_pilot_evidence_mutation"();

COMMIT;
