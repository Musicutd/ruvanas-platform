-- HF.1: additive five-product authority. Legacy rows remain false/null for new capabilities.
ALTER TABLE "Plan"
  ADD COLUMN "healthRadioEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "faithRadioEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Subscription"
  ADD COLUMN "healthRadioEnabled" BOOLEAN,
  ADD COLUMN "faithRadioEnabled" BOOLEAN,
  ADD COLUMN "complimentaryHealthRadioEnabled" BOOLEAN,
  ADD COLUMN "complimentaryFaithRadioEnabled" BOOLEAN;

ALTER TABLE "Station"
  ADD COLUMN "productFamily" "PlanProductFamily",
  ADD COLUMN "audiencePolicy" "StationAudiencePolicy" NOT NULL DEFAULT 'INTERNAL';
CREATE INDEX "Station_organisationId_productFamily_status_idx" ON "Station"("organisationId", "productFamily", "status");

INSERT INTO "Plan" (
  "id", "name", "code", "publicSlug", "productFamily", "tierNumber", "publiclyAvailable",
  "monthlyPriceCents", "stationLimit", "storageLimitGb", "listenerLimit", "maxBitrateKbps",
  "includesRuvanasCatalogue", "licensedMusicCatalogueLevel", "promoUploadEnabled",
  "retailRadioEnabled", "schoolRadioEnabled", "onlineRadioEnabled", "healthRadioEnabled", "faithRadioEnabled",
  "schoolPublicPublishingEnabled", "retailMediaEnabled", "digitalSignageEnabled", "active", "createdAt", "updatedAt"
) VALUES
  ('public-plan-health-start', 'Health Start', 'HEALTH_START', 'health-start', 'HEALTH', 1, true, 2900, 1, 25, 100, 192, true, 'NONE', true, false, false, false, true, false, false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-health-connect', 'Health Connect', 'HEALTH_CONNECT', 'health-connect', 'HEALTH', 2, true, 7900, 3, 100, 500, 256, true, 'NONE', true, false, false, false, true, false, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-health-pro', 'Health Pro', 'HEALTH_PRO', 'health-pro', 'HEALTH', 3, true, 17900, 10, 250, 2000, 320, true, 'FOCUSED', true, false, false, false, true, false, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-health-network', 'Health Network', 'HEALTH_NETWORK', 'health-network', 'HEALTH', 4, true, 44900, 30, 750, 10000, 320, true, 'PROFESSIONAL', true, false, false, false, true, false, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-health-enterprise', 'Health Enterprise', 'HEALTH_ENTERPRISE', 'health-enterprise', 'HEALTH', 5, true, 99900, 100, 2000, 50000, 320, true, 'PREMIUM', true, false, false, false, true, false, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-faith-start', 'Faith Start', 'FAITH_START', 'faith-start', 'FAITH', 1, true, 1990, 1, 25, 100, 192, true, 'NONE', true, false, false, false, false, true, false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-faith-connect', 'Faith Connect', 'FAITH_CONNECT', 'faith-connect', 'FAITH', 2, true, 4900, 3, 100, 500, 256, true, 'NONE', true, false, false, false, false, true, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-faith-pro', 'Faith Pro', 'FAITH_PRO', 'faith-pro', 'FAITH', 3, true, 9900, 10, 250, 2000, 320, true, 'FOCUSED', true, false, false, false, false, true, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-faith-ministry', 'Faith Ministry', 'FAITH_MINISTRY', 'faith-ministry', 'FAITH', 4, true, 19900, 25, 750, 10000, 320, true, 'PROFESSIONAL', true, false, false, false, false, true, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-faith-network', 'Faith Network', 'FAITH_NETWORK', 'faith-network', 'FAITH', 5, true, 49900, 100, 2000, 50000, 320, true, 'PREMIUM', true, false, false, false, false, true, false, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name", "publicSlug" = EXCLUDED."publicSlug", "productFamily" = EXCLUDED."productFamily",
  "tierNumber" = EXCLUDED."tierNumber", "publiclyAvailable" = EXCLUDED."publiclyAvailable", "monthlyPriceCents" = EXCLUDED."monthlyPriceCents",
  "stationLimit" = EXCLUDED."stationLimit", "storageLimitGb" = EXCLUDED."storageLimitGb", "listenerLimit" = EXCLUDED."listenerLimit",
  "maxBitrateKbps" = EXCLUDED."maxBitrateKbps", "includesRuvanasCatalogue" = EXCLUDED."includesRuvanasCatalogue",
  "licensedMusicCatalogueLevel" = EXCLUDED."licensedMusicCatalogueLevel", "promoUploadEnabled" = EXCLUDED."promoUploadEnabled",
  "retailRadioEnabled" = EXCLUDED."retailRadioEnabled", "schoolRadioEnabled" = EXCLUDED."schoolRadioEnabled",
  "onlineRadioEnabled" = EXCLUDED."onlineRadioEnabled", "healthRadioEnabled" = EXCLUDED."healthRadioEnabled",
  "faithRadioEnabled" = EXCLUDED."faithRadioEnabled", "schoolPublicPublishingEnabled" = EXCLUDED."schoolPublicPublishingEnabled",
  "retailMediaEnabled" = EXCLUDED."retailMediaEnabled", "digitalSignageEnabled" = EXCLUDED."digitalSignageEnabled",
  "active" = EXCLUDED."active", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Organisation" ("id", "name", "slug", "createdAt", "updatedAt") VALUES
  ('qa-health-organisation', 'Ruvanas Health QA', 'ruvanas-health-qa', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-faith-organisation', 'Ruvanas Faith QA', 'ruvanas-faith-qa', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Subscription" ("id", "organisationId", "planId", "status", "currentPeriodEnd", "createdAt", "updatedAt")
SELECT 'qa-health-subscription', organisation."id", plan."id", 'TRIAL', CURRENT_TIMESTAMP + INTERVAL '10 years', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organisation" organisation, "Plan" plan
WHERE organisation."slug" = 'ruvanas-health-qa' AND plan."code" = 'HEALTH_PRO'
ON CONFLICT ("organisationId") DO NOTHING;

INSERT INTO "Subscription" ("id", "organisationId", "planId", "status", "currentPeriodEnd", "createdAt", "updatedAt")
SELECT 'qa-faith-subscription', organisation."id", plan."id", 'TRIAL', CURRENT_TIMESTAMP + INTERVAL '10 years', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organisation" organisation, "Plan" plan
WHERE organisation."slug" = 'ruvanas-faith-qa' AND plan."code" = 'FAITH_PRO'
ON CONFLICT ("organisationId") DO NOTHING;
