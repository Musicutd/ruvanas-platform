CREATE TYPE "PlanProductFamily" AS ENUM ('RETAIL', 'SCHOOL', 'ONLINE', 'MULTI');
CREATE TYPE "LicensedMusicCatalogueLevel" AS ENUM ('NONE', 'FOCUSED', 'PROFESSIONAL', 'PREMIUM');

ALTER TABLE "Plan"
  ADD COLUMN "publicSlug" TEXT,
  ADD COLUMN "productFamily" "PlanProductFamily",
  ADD COLUMN "tierNumber" INTEGER,
  ADD COLUMN "publiclyAvailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "licensedMusicCatalogueLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "retailRadioEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "onlineRadioEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Subscription"
  ADD COLUMN "retailRadioEnabled" BOOLEAN,
  ADD COLUMN "onlineRadioEnabled" BOOLEAN,
  ADD COLUMN "complimentaryLicensedMusicCatalogueLevel" "LicensedMusicCatalogueLevel",
  ADD COLUMN "complimentaryRetailRadioEnabled" BOOLEAN,
  ADD COLUMN "complimentaryOnlineRadioEnabled" BOOLEAN;

CREATE UNIQUE INDEX "Plan_publicSlug_key" ON "Plan"("publicSlug");
CREATE INDEX "Plan_productFamily_tierNumber_publiclyAvailable_active_idx"
  ON "Plan"("productFamily", "tierNumber", "publiclyAvailable", "active");

INSERT INTO "Plan" (
  "id", "name", "code", "publicSlug", "productFamily", "tierNumber", "publiclyAvailable",
  "monthlyPriceCents", "stationLimit", "storageLimitGb", "listenerLimit", "maxBitrateKbps",
  "includesRuvanasCatalogue", "licensedMusicCatalogueLevel", "promoUploadEnabled",
  "retailRadioEnabled", "schoolRadioEnabled", "onlineRadioEnabled",
  "schoolPublicPublishingEnabled", "retailMediaEnabled", "digitalSignageEnabled",
  "active", "createdAt", "updatedAt"
)
VALUES
  ('public-plan-retail-start', 'Retail Start', 'RETAIL_START', 'retail-start', 'RETAIL', 1, true, 1490, 1, 10, 100, 192, true, 'NONE', true, true, false, false, false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-retail-business', 'Retail Business', 'RETAIL_BUSINESS', 'retail-business', 'RETAIL', 2, true, 4900, 3, 50, 500, 256, true, 'NONE', true, true, false, false, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-retail-professional', 'Retail Professional', 'RETAIL_PROFESSIONAL', 'retail-professional', 'RETAIL', 3, true, 14900, 10, 200, 2000, 320, true, 'FOCUSED', true, true, false, false, false, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-retail-advanced', 'Retail Advanced', 'RETAIL_ADVANCED', 'retail-advanced', 'RETAIL', 4, true, 39900, 30, 500, 10000, 320, true, 'PROFESSIONAL', true, true, false, false, false, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-retail-enterprise', 'Retail Enterprise', 'RETAIL_ENTERPRISE', 'retail-enterprise', 'RETAIL', 5, true, 99900, 100, 2000, 50000, 320, true, 'PREMIUM', true, true, false, false, false, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-school-start', 'School Start', 'SCHOOL_START', 'school-start', 'SCHOOL', 1, true, 1990, 1, 25, 100, 192, true, 'NONE', true, false, true, false, false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-school-create', 'School Create', 'SCHOOL_CREATE', 'school-create', 'SCHOOL', 2, true, 4900, 1, 100, 300, 256, true, 'NONE', true, false, true, false, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-school-pro', 'School Pro', 'SCHOOL_PRO', 'school-pro', 'SCHOOL', 3, true, 9900, 3, 250, 1000, 320, true, 'FOCUSED', true, false, true, false, true, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-school-academy', 'School Academy', 'SCHOOL_ACADEMY', 'school-academy', 'SCHOOL', 4, true, 24900, 10, 750, 5000, 320, true, 'PROFESSIONAL', true, false, true, false, true, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-school-enterprise', 'Education Enterprise', 'SCHOOL_ENTERPRISE', 'education-enterprise', 'SCHOOL', 5, true, 59900, 50, 2000, 20000, 320, true, 'PREMIUM', true, false, true, false, true, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-online-hobby', 'Online Hobby', 'ONLINE_HOBBY', 'online-hobby', 'ONLINE', 1, true, 1490, 1, 25, 100, 192, true, 'NONE', true, false, false, true, false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-online-starter', 'Online Starter', 'ONLINE_STARTER', 'online-starter', 'ONLINE', 2, true, 3900, 1, 100, 500, 256, true, 'NONE', true, false, false, true, false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-online-professional', 'Online Professional', 'ONLINE_PROFESSIONAL', 'online-professional', 'ONLINE', 3, true, 8900, 3, 250, 2000, 320, true, 'FOCUSED', true, false, false, true, false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-online-station-pro', 'Online Station Pro', 'ONLINE_STATION_PRO', 'online-station-pro', 'ONLINE', 4, true, 19900, 10, 750, 10000, 320, true, 'PROFESSIONAL', true, false, false, true, false, true, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-online-network', 'Online Network', 'ONLINE_NETWORK', 'online-network', 'ONLINE', 5, true, 49900, 50, 2000, 50000, 320, true, 'PREMIUM', true, false, false, true, false, true, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "publicSlug" = EXCLUDED."publicSlug",
  "productFamily" = EXCLUDED."productFamily",
  "tierNumber" = EXCLUDED."tierNumber",
  "publiclyAvailable" = EXCLUDED."publiclyAvailable",
  "monthlyPriceCents" = EXCLUDED."monthlyPriceCents",
  "stationLimit" = EXCLUDED."stationLimit",
  "storageLimitGb" = EXCLUDED."storageLimitGb",
  "listenerLimit" = EXCLUDED."listenerLimit",
  "maxBitrateKbps" = EXCLUDED."maxBitrateKbps",
  "includesRuvanasCatalogue" = EXCLUDED."includesRuvanasCatalogue",
  "licensedMusicCatalogueLevel" = EXCLUDED."licensedMusicCatalogueLevel",
  "promoUploadEnabled" = EXCLUDED."promoUploadEnabled",
  "retailRadioEnabled" = EXCLUDED."retailRadioEnabled",
  "schoolRadioEnabled" = EXCLUDED."schoolRadioEnabled",
  "onlineRadioEnabled" = EXCLUDED."onlineRadioEnabled",
  "schoolPublicPublishingEnabled" = EXCLUDED."schoolPublicPublishingEnabled",
  "retailMediaEnabled" = EXCLUDED."retailMediaEnabled",
  "digitalSignageEnabled" = EXCLUDED."digitalSignageEnabled",
  "active" = EXCLUDED."active",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Existing legacy plans remain non-public and receive no Retail or Online access.
-- Preserve only an already-authoritative School capability; every licensed catalogue
-- entitlement remains NONE until an explicit public plan or approved entitlement applies.
