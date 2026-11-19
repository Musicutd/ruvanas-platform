-- RR-07k LOCAL CANDIDATE: no hosted migration or activation is authorized.
-- Forward-only repair for logical backup/restore under an empty search_path.
-- Keep the existing validator signatures, validation rules and security-invoker
-- behavior. CREATE OR REPLACE retains function OIDs and existing CHECK links.
-- Qualify only custom functions/types; do not trust the restoring session's path.
-- No backfill, grants, feature flags, table/constraint changes or history edits.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public."ruvanas_rewards_audit_snapshot_valid"(snapshot JSONB)
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
        IF NOT (jsonb_typeof(entry.value) = 'string' AND public."ruvanas_rewards_identifier_valid"(scalar)) THEN RETURN false; END IF;
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
          NOT public."ruvanas_rewards_capabilities_valid"(ARRAY(SELECT jsonb_array_elements_text(entry.value))::public."RewardAction"[]) THEN RETURN false; END IF;
      ELSE
        RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public."ruvanas_rewards_audit_metadata_valid"(metadata JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  entry RECORD;
  scalar TEXT;
BEGIN
  IF jsonb_typeof(metadata) <> 'object' OR octet_length(metadata::text) > 16384 THEN RETURN false; END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(metadata) LOOP
    scalar := entry.value #>> '{}';
    CASE
      WHEN entry.key IN ('before', 'after') THEN
        IF NOT public."ruvanas_rewards_audit_snapshot_valid"(entry.value) THEN RETURN false; END IF;
      WHEN entry.key = 'reasonCode' THEN
        IF NOT (jsonb_typeof(entry.value) = 'string' AND scalar IN
          ('MANUAL_INTERNAL', 'OWNER_REQUEST', 'REVOKED', 'EXPIRED', 'SUSPENDED', 'CORRECTION')) THEN RETURN false; END IF;
      WHEN entry.key IN ('version', 'revision') THEN
        IF jsonb_typeof(entry.value) <> 'number' OR scalar::numeric < 0 OR
          scalar::numeric > 2147483647 OR mod(scalar::numeric, 1) <> 0 THEN RETURN false; END IF;
      ELSE RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public."ruvanas_rewards_campaign_snapshot_valid"(snapshot JSONB)
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
    IF jsonb_typeof(entry) <> 'string' OR NOT public."ruvanas_rewards_identifier_valid"(entry #>> '{}') THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(snapshot -> 'locationIds')) <> jsonb_array_length(snapshot -> 'locationIds') THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

COMMIT;
