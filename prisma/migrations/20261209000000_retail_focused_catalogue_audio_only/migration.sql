-- Retail's five standard tiers share the Focused Licensed Music Catalogue.
-- This changes plan access only: existing product-use and territory checks,
-- track rights, subscriptions, stream approvals and commercial limits remain.
-- Digital displays are paused for Retail; no saved display or media is deleted.
UPDATE "Plan"
SET
  "licensedMusicCatalogueLevel" = 'FOCUSED',
  "digitalSignageEnabled" = false,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "productFamily" = 'RETAIL'
  AND "code" IN (
    'RETAIL_START',
    'RETAIL_BUSINESS',
    'RETAIL_PROFESSIONAL',
    'RETAIL_ADVANCED',
    'RETAIL_ENTERPRISE'
  )
  AND (
    "licensedMusicCatalogueLevel" IS DISTINCT FROM 'FOCUSED'
    OR "digitalSignageEnabled" IS DISTINCT FROM false
  );
