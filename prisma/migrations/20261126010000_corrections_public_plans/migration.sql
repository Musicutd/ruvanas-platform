-- A separate migration is required so PostgreSQL can commit the new enum value first.
-- Existing subscriptions and plans remain denied. Only these five new plans enable Corrections.
INSERT INTO "Plan" (
  "id", "name", "code", "publicSlug", "productFamily", "tierNumber", "publiclyAvailable",
  "monthlyPriceCents", "stationLimit", "storageLimitGb", "listenerLimit", "maxBitrateKbps",
  "includesRuvanasCatalogue", "licensedMusicCatalogueLevel", "promoUploadEnabled",
  "correctionsRadioEnabled", "active", "createdAt", "updatedAt"
) VALUES
  ('public-plan-corrections-essential', 'Inside Essential', 'CORRECTIONS_ESSENTIAL', 'corrections-essential', 'CORRECTIONS', 1, true, 14900, 1, 25, 100, 192, true, 'NONE', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-corrections-facility', 'Inside Facility', 'CORRECTIONS_FACILITY', 'corrections-facility', 'CORRECTIONS', 2, true, 29900, 1, 100, 500, 256, true, 'NONE', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-corrections-rehabilitation-pro', 'Inside Rehabilitation Pro', 'CORRECTIONS_REHABILITATION_PRO', 'corrections-rehabilitation-pro', 'CORRECTIONS', 3, true, 59900, 1, 250, 2000, 320, true, 'FOCUSED', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-corrections-network', 'Inside Network', 'CORRECTIONS_NETWORK', 'corrections-network', 'CORRECTIONS', 4, true, 119900, 5, 1000, 10000, 320, true, 'PROFESSIONAL', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('public-plan-corrections-justice-enterprise', 'Justice Enterprise', 'CORRECTIONS_JUSTICE_ENTERPRISE', 'corrections-justice-enterprise', 'CORRECTIONS', 5, true, 249900, 50, 3000, 50000, 320, true, 'PREMIUM', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
