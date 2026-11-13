-- RR-01b CANDIDATE: production predecessor/history has not been verified.
-- Additive foundation only: no tenant backfill, activation, prices or runtime
-- wiring. Retain these tables on application rollback. Never edit applied SQL.

BEGIN;

CREATE TYPE "RewardProgramStatus" AS ENUM ('DISABLED', 'ACTIVE', 'PAUSED');
CREATE TYPE "RewardGrantStatus" AS ENUM ('DISABLED', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "RewardTier" AS ENUM ('REWARDS_STARTER', 'REWARDS_PRO', 'REWARDS_BUSINESS', 'REWARDS_ENTERPRISE');
CREATE TYPE "RewardStaffScope" AS ENUM ('ALL_LOCATIONS', 'LOCATIONS');
CREATE TYPE "RewardAction" AS ENUM ('READ', 'MANAGE_OFFERS', 'PUBLISH_OFFERS', 'REDEEM', 'REVERSE', 'VIEW_INSIGHTS', 'EXPORT', 'MANAGE_STAFF');
CREATE TYPE "RewardAuditAction" AS ENUM ('PROGRAM_CREATED', 'PROGRAM_CHANGED', 'ENTITLEMENT_CREATED', 'ENTITLEMENT_CHANGED', 'ENTITLEMENT_REVOKED', 'STAFF_GRANT_CREATED', 'STAFF_GRANT_CHANGED', 'STAFF_GRANT_REVOKED');
CREATE TYPE "RewardAuditTargetType" AS ENUM ('PROGRAM', 'ENTITLEMENT_GRANT', 'STAFF_GRANT');

-- Existing IDs are already primary keys. These additional keys make tenant
-- ownership enforceable by each new composite FK, not by independent ID FKs.
CREATE UNIQUE INDEX "OrganisationMember_id_organisationId_key" ON "OrganisationMember"("id", "organisationId");
CREATE UNIQUE INDEX "Subscription_id_organisationId_key" ON "Subscription"("id", "organisationId");
CREATE UNIQUE INDEX "Location_id_organisationId_key" ON "Location"("id", "organisationId");

CREATE FUNCTION "ruvanas_rewards_identifier_valid"(value TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT char_length(value) BETWEEN 1 AND 191
    AND value ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$';
$$;

CREATE FUNCTION "ruvanas_rewards_capabilities_valid"(value "RewardAction"[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE WHEN array_ndims(value) IS DISTINCT FROM 1 THEN false ELSE
    cardinality(value) BETWEEN 1 AND 8
    AND array_position(value, NULL) IS NULL
    AND cardinality(value) = (SELECT count(DISTINCT item) FROM unnest(value) AS item)
  END;
$$;

-- No free text, contact information, secrets or arbitrary nested JSON is
-- accepted. Before/after snapshots contain only typed foundation-policy fields.
CREATE FUNCTION "ruvanas_rewards_audit_snapshot_valid"(snapshot JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  entry RECORD;
  scalar TEXT;
BEGIN
  IF jsonb_typeof(snapshot) <> 'object' OR octet_length(snapshot::text) > 8192 THEN
    RETURN false;
  END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(snapshot) LOOP
    scalar := entry.value #>> '{}';
    CASE
      WHEN entry.key = 'status' THEN
        IF NOT (jsonb_typeof(entry.value) = 'string' AND scalar IN
          ('DISABLED', 'ACTIVE', 'PAUSED', 'TRIAL', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED')) THEN RETURN false; END IF;
      WHEN entry.key = 'tier' THEN
        IF NOT (jsonb_typeof(entry.value) = 'string' AND scalar IN
          ('REWARDS_STARTER', 'REWARDS_PRO', 'REWARDS_BUSINESS', 'REWARDS_ENTERPRISE')) THEN RETURN false; END IF;
      WHEN entry.key = 'capability' THEN
        IF entry.value <> '"RETAIL_REWARDS"'::jsonb THEN RETURN false; END IF;
      WHEN entry.key = 'source' THEN
        IF entry.value <> '"MANUAL_INTERNAL"'::jsonb THEN RETURN false; END IF;
      WHEN entry.key = 'scope' THEN
        IF NOT (jsonb_typeof(entry.value) = 'string' AND scalar IN ('ALL_LOCATIONS', 'LOCATIONS')) THEN RETURN false; END IF;
      WHEN entry.key IN ('locationId', 'organisationMemberId') THEN
        IF entry.value = 'null'::jsonb AND entry.key = 'locationId' THEN CONTINUE; END IF;
        IF NOT (jsonb_typeof(entry.value) = 'string' AND "ruvanas_rewards_identifier_valid"(scalar)) THEN RETURN false; END IF;
      WHEN entry.key IN ('startsAt', 'expiresAt', 'revokedAt') THEN
        IF entry.value = 'null'::jsonb AND entry.key = 'revokedAt' THEN CONTINUE; END IF;
        IF jsonb_typeof(entry.value) <> 'string' OR
          scalar !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' OR
          NOT isfinite(scalar::timestamptz) THEN RETURN false; END IF;
      WHEN entry.key = 'limitsVersion' THEN
        IF entry.value <> '1'::jsonb THEN RETURN false; END IF;
      WHEN entry.key IN ('activeOffers', 'locations', 'staffSeats', 'monthlyRedemptions', 'analyticsRetentionDays') THEN
        IF jsonb_typeof(entry.value) <> 'number' OR scalar::numeric < 0 OR
          scalar::numeric > 1000000000 OR mod(scalar::numeric, 1) <> 0 THEN RETURN false; END IF;
      WHEN entry.key IN ('exportEnabled', 'brandingEnabled', 'networkOptIn') THEN
        IF jsonb_typeof(entry.value) <> 'boolean' THEN RETURN false; END IF;
      WHEN entry.key = 'timezone' THEN
        IF jsonb_typeof(entry.value) <> 'string' OR char_length(scalar) NOT BETWEEN 1 AND 64 OR
          scalar !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' THEN RETURN false; END IF;
      WHEN entry.key = 'capabilities' THEN
        IF jsonb_typeof(entry.value) <> 'array' OR jsonb_array_length(entry.value) NOT BETWEEN 1 AND 8 OR
          EXISTS (SELECT 1 FROM jsonb_array_elements(entry.value) AS item WHERE jsonb_typeof(item) <> 'string') OR
          NOT "ruvanas_rewards_capabilities_valid"(ARRAY(SELECT jsonb_array_elements_text(entry.value))::"RewardAction"[]) THEN RETURN false; END IF;
      ELSE
        RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE FUNCTION "ruvanas_rewards_audit_metadata_valid"(metadata JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  entry RECORD;
BEGIN
  IF jsonb_typeof(metadata) <> 'object' OR octet_length(metadata::text) > 16384 THEN RETURN false; END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(metadata) LOOP
    CASE
      WHEN entry.key IN ('before', 'after') THEN
        IF NOT "ruvanas_rewards_audit_snapshot_valid"(entry.value) THEN RETURN false; END IF;
      WHEN entry.key = 'reasonCode' THEN
        IF NOT (jsonb_typeof(entry.value) = 'string' AND entry.value #>> '{}' IN
          ('MANUAL_INTERNAL', 'OWNER_REQUEST', 'REVOKED', 'EXPIRED', 'SUSPENDED', 'CORRECTION')) THEN RETURN false; END IF;
      ELSE
        RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE TABLE "RewardProgram" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "status" "RewardProgramStatus" NOT NULL DEFAULT 'DISABLED',
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Malta',
  "networkOptIn" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardProgram_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardProgram_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId")),
  CONSTRAINT "RewardProgram_timezone_check" CHECK (
    char_length("timezone") BETWEEN 1 AND 64 AND "timezone" ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'),
  CONSTRAINT "RewardProgram_timestamps_check" CHECK (isfinite("createdAt") AND isfinite("updatedAt"))
);

CREATE TABLE "RewardEntitlementGrant" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "capability" VARCHAR(32) NOT NULL DEFAULT 'RETAIL_REWARDS',
  "source" VARCHAR(32) NOT NULL DEFAULT 'MANUAL_INTERNAL',
  "tier" "RewardTier" NOT NULL,
  "status" "RewardGrantStatus" NOT NULL DEFAULT 'DISABLED',
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "limitsVersion" INTEGER NOT NULL DEFAULT 1,
  "activeOffers" INTEGER NOT NULL,
  "locations" INTEGER NOT NULL,
  "staffSeats" INTEGER NOT NULL,
  "monthlyRedemptions" INTEGER NOT NULL,
  "analyticsRetentionDays" INTEGER NOT NULL,
  "exportEnabled" BOOLEAN NOT NULL,
  "brandingEnabled" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardEntitlementGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardEntitlementGrant_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("subscriptionId")),
  CONSTRAINT "RewardEntitlementGrant_authority_check" CHECK (
    "capability" = 'RETAIL_REWARDS' AND "source" = 'MANUAL_INTERNAL' AND "limitsVersion" = 1),
  CONSTRAINT "RewardEntitlementGrant_window_check" CHECK (
    isfinite("startsAt") AND isfinite("expiresAt") AND "startsAt" < "expiresAt" AND
    ("revokedAt" IS NULL OR isfinite("revokedAt"))),
  CONSTRAINT "RewardEntitlementGrant_limits_check" CHECK (
    "activeOffers" BETWEEN 0 AND 1000000000 AND "locations" BETWEEN 0 AND 1000000000 AND
    "staffSeats" BETWEEN 0 AND 1000000000 AND "monthlyRedemptions" BETWEEN 0 AND 1000000000 AND
    "analyticsRetentionDays" BETWEEN 0 AND 1000000000),
  CONSTRAINT "RewardEntitlementGrant_timestamps_check" CHECK (isfinite("createdAt") AND isfinite("updatedAt"))
);

CREATE TABLE "RewardStaffGrant" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "organisationMemberId" TEXT NOT NULL,
  "scope" "RewardStaffScope" NOT NULL,
  "locationId" TEXT,
  "capabilities" "RewardAction"[] NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardStaffGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardStaffGrant_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("organisationMemberId") AND
    ("locationId" IS NULL OR "ruvanas_rewards_identifier_valid"("locationId"))),
  CONSTRAINT "RewardStaffGrant_scope_check" CHECK (
    ("scope" = 'ALL_LOCATIONS' AND "locationId" IS NULL) OR
    ("scope" = 'LOCATIONS' AND "locationId" IS NOT NULL)),
  CONSTRAINT "RewardStaffGrant_capabilities_check" CHECK ("ruvanas_rewards_capabilities_valid"("capabilities")),
  CONSTRAINT "RewardStaffGrant_window_check" CHECK (
    isfinite("startsAt") AND isfinite("expiresAt") AND "startsAt" < "expiresAt" AND
    ("revokedAt" IS NULL OR isfinite("revokedAt"))),
  CONSTRAINT "RewardStaffGrant_timestamps_check" CHECK (isfinite("createdAt") AND isfinite("updatedAt"))
);

CREATE TABLE "RewardAuditEvent" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "actorUserId" VARCHAR(191),
  "actorOrganisationMemberId" VARCHAR(191),
  "action" "RewardAuditAction" NOT NULL,
  "targetType" "RewardAuditTargetType" NOT NULL,
  "targetId" VARCHAR(191) NOT NULL,
  "requestId" VARCHAR(191),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardAuditEvent_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("targetId") AND
    ("actorUserId" IS NULL OR "ruvanas_rewards_identifier_valid"("actorUserId")) AND
    ("actorOrganisationMemberId" IS NULL OR "ruvanas_rewards_identifier_valid"("actorOrganisationMemberId")) AND
    ("requestId" IS NULL OR "ruvanas_rewards_identifier_valid"("requestId"))),
  CONSTRAINT "RewardAuditEvent_actor_check" CHECK ("actorOrganisationMemberId" IS NULL OR "actorUserId" IS NOT NULL),
  CONSTRAINT "RewardAuditEvent_target_check" CHECK (
    ("targetType" = 'PROGRAM' AND "action" IN ('PROGRAM_CREATED', 'PROGRAM_CHANGED')) OR
    ("targetType" = 'ENTITLEMENT_GRANT' AND "action" IN ('ENTITLEMENT_CREATED', 'ENTITLEMENT_CHANGED', 'ENTITLEMENT_REVOKED')) OR
    ("targetType" = 'STAFF_GRANT' AND "action" IN ('STAFF_GRANT_CREATED', 'STAFF_GRANT_CHANGED', 'STAFF_GRANT_REVOKED'))),
  CONSTRAINT "RewardAuditEvent_metadata_check" CHECK ("ruvanas_rewards_audit_metadata_valid"("metadata")),
  CONSTRAINT "RewardAuditEvent_timestamp_check" CHECK (isfinite("createdAt"))
);

CREATE UNIQUE INDEX "RewardProgram_organisationId_key" ON "RewardProgram"("organisationId");
CREATE UNIQUE INDEX "RewardEntitlementGrant_organisationId_key" ON "RewardEntitlementGrant"("organisationId");
CREATE INDEX "RewardEntitlementGrant_subscriptionId_organisationId_idx" ON "RewardEntitlementGrant"("subscriptionId", "organisationId");
CREATE INDEX "RewardEntitlementGrant_organisationId_status_expiresAt_idx" ON "RewardEntitlementGrant"("organisationId", "status", "expiresAt");
CREATE UNIQUE INDEX "RewardStaffGrant_member_location_key" ON "RewardStaffGrant"("organisationId", "organisationMemberId", "locationId");
-- Prisma 6 does not represent partial indexes. Retain and test this SQL guard.
CREATE UNIQUE INDEX "RewardStaffGrant_member_all_key" ON "RewardStaffGrant"("organisationId", "organisationMemberId") WHERE "scope" = 'ALL_LOCATIONS';
CREATE INDEX "RewardStaffGrant_member_expiry_idx" ON "RewardStaffGrant"("organisationId", "organisationMemberId", "expiresAt");
CREATE INDEX "RewardStaffGrant_locationId_organisationId_idx" ON "RewardStaffGrant"("locationId", "organisationId");
CREATE INDEX "RewardAuditEvent_organisationId_createdAt_id_idx" ON "RewardAuditEvent"("organisationId", "createdAt", "id");
CREATE INDEX "RewardAuditEvent_organisationId_action_createdAt_idx" ON "RewardAuditEvent"("organisationId", "action", "createdAt");
CREATE INDEX "RewardAuditEvent_target_time_idx" ON "RewardAuditEvent"("organisationId", "targetType", "targetId", "createdAt");

ALTER TABLE "RewardProgram" ADD CONSTRAINT "RewardProgram_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardEntitlementGrant" ADD CONSTRAINT "RewardEntitlementGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardEntitlementGrant" ADD CONSTRAINT "RewardEntitlementGrant_subscriptionId_organisationId_fkey" FOREIGN KEY ("subscriptionId", "organisationId") REFERENCES "Subscription"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardStaffGrant" ADD CONSTRAINT "RewardStaffGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardStaffGrant" ADD CONSTRAINT "RewardStaffGrant_organisationMemberId_organisationId_fkey" FOREIGN KEY ("organisationMemberId", "organisationId") REFERENCES "OrganisationMember"("id", "organisationId") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "RewardStaffGrant" ADD CONSTRAINT "RewardStaffGrant_locationId_organisationId_fkey" FOREIGN KEY ("locationId", "organisationId") REFERENCES "Location"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardAuditEvent" ADD CONSTRAINT "RewardAuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "ruvanas_prevent_reward_audit_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Rewards audit evidence is append-only';
END;
$$;

CREATE TRIGGER "RewardAuditEvent_immutable"
  BEFORE UPDATE OR DELETE ON "RewardAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_audit_mutation"();
CREATE TRIGGER "RewardAuditEvent_no_truncate"
  BEFORE TRUNCATE ON "RewardAuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_audit_mutation"();

COMMIT;
