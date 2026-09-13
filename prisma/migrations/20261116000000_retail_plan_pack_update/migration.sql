UPDATE "Plan"
SET
  "monthlyPriceCents" = CASE "code"
    WHEN 'RETAIL_START' THEN 1900
    ELSE "monthlyPriceCents"
  END,
  "storageLimitGb" = CASE "code"
    WHEN 'RETAIL_START' THEN 5
    WHEN 'RETAIL_BUSINESS' THEN 15
    WHEN 'RETAIL_PROFESSIONAL' THEN 100
    WHEN 'RETAIL_ADVANCED' THEN 200
    WHEN 'RETAIL_ENTERPRISE' THEN 2000
    ELSE "storageLimitGb"
  END,
  "maxBitrateKbps" = CASE "code"
    WHEN 'RETAIL_START' THEN 128
    ELSE "maxBitrateKbps"
  END,
  "digitalSignageEnabled" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'RETAIL_START',
  'RETAIL_BUSINESS',
  'RETAIL_PROFESSIONAL',
  'RETAIL_ADVANCED',
  'RETAIL_ENTERPRISE'
);
