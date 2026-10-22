-- One explicit owner-test profile for the existing isolated Test Radio only.
-- Historical five-minute records and the one-active-test index are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "OnlineRadioCatalogueTest"
  DROP CONSTRAINT "catalogue_test_duration_bound",
  DROP CONSTRAINT "catalogue_test_deadline",
  ADD CONSTRAINT "catalogue_test_duration_bound" CHECK ((
    ("durationSeconds" >= 1 AND "durationSeconds" <= 300)
    OR (
      "durationSeconds" = 3600
      AND "stationId" = 'cmvcnbwi20008hr23sd76psi8'
      AND "authorization" -> 'profileId' = '"ONE_HOUR"'::jsonb
      AND "authorization" -> 'maximumSeconds' = '3600'::jsonb
      AND "authorization" -> 'stationId' = to_jsonb("stationId")
      AND "authorization" -> 'organisationId' = to_jsonb("organisationId")
      AND "authorization" -> 'kind' = '"OWNER_CATALOGUE_TEST"'::jsonb
      AND "authorization" -> 'actorRole' = '"SUPER_ADMIN"'::jsonb
      AND "plan" -> 'profileId' = '"ONE_HOUR"'::jsonb
      AND "plan" -> 'targetSeconds' = '3600'::jsonb
      AND "expiresAt" > "createdAt"
      AND "expiresAt" <= "createdAt" + INTERVAL '4200 seconds'
    )
  ) IS TRUE),
  ADD CONSTRAINT "catalogue_test_deadline" CHECK ((
    "deadlineAt" IS NULL OR (
      "requestedAt" IS NOT NULL
      AND "deadlineAt" > "requestedAt"
      AND "deadlineAt" <= "expiresAt"
      AND (
        ("durationSeconds" <= 300 AND "deadlineAt" <= "requestedAt" + INTERVAL '300 seconds')
        OR ("durationSeconds" = 3600 AND "deadlineAt" <= "requestedAt" + INTERVAL '3600 seconds')
      )
    )
  ) IS TRUE);
COMMIT;
