-- RR-03a: separate shopper identity and explicit discovery projections.
-- No onboarding, credentials, client grants, publication or backfill is created.
-- RewardProgram.networkOptIn already exists and remains false unless explicitly set.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "RewardShopperStatus" AS ENUM ('DISABLED', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "RewardPublicShopStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE FUNCTION "ruvanas_rewards_public_text_valid"(value TEXT, minimum INTEGER, maximum INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT char_length(value) BETWEEN minimum AND maximum
    AND value = btrim(value)
    AND value !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]';
$$;

CREATE TABLE "RewardShopper" (
  "id" TEXT NOT NULL,
  "displayName" VARCHAR(80),
  "status" "RewardShopperStatus" NOT NULL DEFAULT 'DISABLED',
  "authVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardShopper_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardShopper_identifier_check" CHECK ("ruvanas_rewards_identifier_valid"("id")),
  CONSTRAINT "RewardShopper_displayName_check" CHECK ("displayName" IS NULL OR "ruvanas_rewards_public_text_valid"("displayName", 1, 80)),
  CONSTRAINT "RewardShopper_authVersion_check" CHECK ("authVersion" >= 1),
  CONSTRAINT "RewardShopper_timestamps_check" CHECK (isfinite("createdAt") AND isfinite("updatedAt"))
);

CREATE TABLE "RewardShopperSession" (
  "id" TEXT NOT NULL,
  "shopperId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "authVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "RewardShopperSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardShopperSession_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("shopperId")),
  CONSTRAINT "RewardShopperSession_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RewardShopperSession_authVersion_check" CHECK ("authVersion" >= 1),
  CONSTRAINT "RewardShopperSession_expiry_check" CHECK (
    isfinite("createdAt") AND isfinite("expiresAt") AND "createdAt" < "expiresAt" AND
    "expiresAt" <= "createdAt" + INTERVAL '24 hours' AND
    ("revokedAt" IS NULL OR (isfinite("revokedAt") AND "revokedAt" >= "createdAt")))
);
CREATE UNIQUE INDEX "RewardShopperSession_tokenHash_key" ON "RewardShopperSession"("tokenHash");
CREATE INDEX "RewardShopperSession_shopperId_expiresAt_idx" ON "RewardShopperSession"("shopperId", "expiresAt");
CREATE INDEX "RewardShopperSession_expiresAt_idx" ON "RewardShopperSession"("expiresAt");
ALTER TABLE "RewardShopperSession" ADD CONSTRAINT "RewardShopperSession_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "RewardShopper"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "RewardShopperMembership" (
  "id" TEXT NOT NULL,
  "shopperId" TEXT NOT NULL,
  "status" "RewardShopperStatus" NOT NULL DEFAULT 'DISABLED',
  "source" VARCHAR(32) NOT NULL DEFAULT 'MANUAL_INTERNAL',
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardShopperMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardShopperMembership_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("shopperId")),
  CONSTRAINT "RewardShopperMembership_source_check" CHECK ("source" = 'MANUAL_INTERNAL'),
  CONSTRAINT "RewardShopperMembership_version_check" CHECK ("version" >= 1),
  CONSTRAINT "RewardShopperMembership_expiry_check" CHECK (
    isfinite("startsAt") AND isfinite("expiresAt") AND "startsAt" < "expiresAt" AND
    ("revokedAt" IS NULL OR isfinite("revokedAt"))),
  CONSTRAINT "RewardShopperMembership_timestamps_check" CHECK (isfinite("createdAt") AND isfinite("updatedAt"))
);
CREATE UNIQUE INDEX "RewardShopperMembership_shopperId_key" ON "RewardShopperMembership"("shopperId");
CREATE INDEX "RewardShopperMembership_status_expiresAt_idx" ON "RewardShopperMembership"("status", "expiresAt");
ALTER TABLE "RewardShopperMembership" ADD CONSTRAINT "RewardShopperMembership_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "RewardShopper"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "RewardPublicShopProfile" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "publicSlug" VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(140) NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "locality" VARCHAR(120) NOT NULL,
  "countryCode" VARCHAR(2) NOT NULL,
  "status" "RewardPublicShopStatus" NOT NULL DEFAULT 'DRAFT',
  "networkOptIn" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardPublicShopProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardPublicShopProfile_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND "ruvanas_rewards_identifier_valid"("locationId")),
  CONSTRAINT "RewardPublicShopProfile_publicSlug_check" CHECK (char_length("publicSlug") BETWEEN 3 AND 96 AND "publicSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "RewardPublicShopProfile_text_check" CHECK (
    "ruvanas_rewards_public_text_valid"("displayName", 1, 140) AND
    "ruvanas_rewards_public_text_valid"("description", 0, 2000) AND
    "ruvanas_rewards_public_text_valid"("locality", 0, 120) AND "countryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "RewardPublicShopProfile_publication_check" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL),
  CONSTRAINT "RewardPublicShopProfile_timestamps_check" CHECK (
    isfinite("createdAt") AND isfinite("updatedAt") AND ("publishedAt" IS NULL OR isfinite("publishedAt")) AND
    ("revokedAt" IS NULL OR isfinite("revokedAt")))
);
CREATE UNIQUE INDEX "RewardPublicShopProfile_locationId_key" ON "RewardPublicShopProfile"("locationId");
CREATE UNIQUE INDEX "RewardPublicShopProfile_publicSlug_key" ON "RewardPublicShopProfile"("publicSlug");
CREATE INDEX "RewardPublicShopProfile_locationId_organisationId_idx" ON "RewardPublicShopProfile"("locationId", "organisationId");
CREATE INDEX "RewardPublicShopProfile_organisationId_status_publicSlug_idx" ON "RewardPublicShopProfile"("organisationId", "status", "publicSlug");
ALTER TABLE "RewardPublicShopProfile" ADD CONSTRAINT "RewardPublicShopProfile_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardPublicShopProfile" ADD CONSTRAINT "RewardPublicShopProfile_locationId_organisationId_fkey"
  FOREIGN KEY ("locationId", "organisationId") REFERENCES "Location"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "RewardOfferDiscovery" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "publicSlug" VARCHAR(100) NOT NULL,
  "discoverable" BOOLEAN NOT NULL DEFAULT false,
  "approvedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardOfferDiscovery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardOfferDiscovery_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND "ruvanas_rewards_identifier_valid"("offerId")),
  CONSTRAINT "RewardOfferDiscovery_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "RewardOfferDiscovery_publicSlug_check" CHECK (char_length("publicSlug") BETWEEN 3 AND 96 AND "publicSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "RewardOfferDiscovery_approval_check" CHECK (NOT "discoverable" OR "approvedAt" IS NOT NULL),
  CONSTRAINT "RewardOfferDiscovery_timestamps_check" CHECK (
    isfinite("createdAt") AND isfinite("updatedAt") AND ("approvedAt" IS NULL OR isfinite("approvedAt")) AND
    ("revokedAt" IS NULL OR isfinite("revokedAt")))
);
CREATE UNIQUE INDEX "RewardOfferDiscovery_offerId_key" ON "RewardOfferDiscovery"("offerId");
CREATE UNIQUE INDEX "RewardOfferDiscovery_publicSlug_key" ON "RewardOfferDiscovery"("publicSlug");
CREATE UNIQUE INDEX "RewardOfferDiscovery_offerId_organisationId_key" ON "RewardOfferDiscovery"("offerId", "organisationId");
CREATE INDEX "RewardOfferDiscovery_offerId_revision_organisationId_idx" ON "RewardOfferDiscovery"("offerId", "revision", "organisationId");
CREATE INDEX "RewardOfferDiscovery_organisationId_discoverable_publicSlug_idx" ON "RewardOfferDiscovery"("organisationId", "discoverable", "publicSlug");
ALTER TABLE "RewardOfferDiscovery" ADD CONSTRAINT "RewardOfferDiscovery_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOfferDiscovery" ADD CONSTRAINT "RewardOfferDiscovery_offerId_organisationId_fkey"
  FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOffer"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOfferDiscovery" ADD CONSTRAINT "RewardOfferDiscovery_offerId_revision_organisationId_fkey"
  FOREIGN KEY ("offerId", "revision", "organisationId") REFERENCES "RewardOfferRevision"("offerId", "revision", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
