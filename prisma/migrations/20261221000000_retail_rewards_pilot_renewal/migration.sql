-- Local candidate: truthful, immutable renewal evidence and retry uniqueness.
-- No records, expiry, quotas, plans, credentials or feature flags are changed.
-- Retain this additive schema/evidence on rollback; older applications must
-- keep Rewards disabled because their audit DTO cannot read the new action.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TYPE public."RewardPilotAuditAction" ADD VALUE 'PILOT_ACCESS_RENEWED';

-- The new value is compared as text inside this transaction, so PostgreSQL
-- does not use an uncommitted enum value. Old action metadata remains strict.
CREATE FUNCTION public.ruvanas_rewards_pilot_renewal_metadata_valid(metadata JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, public AS $$
DECLARE entry RECORD; scalar TEXT; parsed_time TIMESTAMPTZ;
BEGIN
  IF jsonb_typeof(metadata) <> 'object' OR octet_length(metadata::text) > 2048 OR
    (SELECT count(*) FROM jsonb_object_keys(metadata)) <> 10 THEN RETURN false; END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(metadata) LOOP
    scalar := entry.value #>> '{}';
    CASE
      WHEN entry.key = 'membershipVersion' THEN
        IF jsonb_typeof(entry.value) <> 'number' OR scalar::numeric < 2 OR
          scalar::numeric > 2147483647 OR mod(scalar::numeric, 1) <> 0 THEN RETURN false; END IF;
      WHEN entry.key IN ('expiresAt', 'previousGrantExpiry', 'previousMembershipExpiry') THEN
        IF jsonb_typeof(entry.value) <> 'string' OR
          scalar !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN RETURN false; END IF;
        parsed_time := scalar::timestamptz;
        IF NOT isfinite(parsed_time) OR to_char(parsed_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> scalar THEN RETURN false; END IF;
      WHEN entry.key IN ('requestHash', 'afterStateHash') THEN
        IF jsonb_typeof(entry.value) <> 'string' OR scalar !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
      WHEN entry.key IN ('shopperId', 'grantId', 'membershipId') THEN
        IF jsonb_typeof(entry.value) <> 'string' OR NOT public.ruvanas_rewards_identifier_valid(scalar) THEN RETURN false; END IF;
      WHEN entry.key = 'status' THEN
        IF jsonb_typeof(entry.value) <> 'string' OR scalar <> 'RENEWED' THEN RETURN false; END IF;
      ELSE RETURN false;
    END CASE;
  END LOOP;
  RETURN (metadata->>'expiresAt')::timestamptz > (metadata->>'previousGrantExpiry')::timestamptz AND
    (metadata->>'expiresAt')::timestamptz > (metadata->>'previousMembershipExpiry')::timestamptz;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

ALTER TABLE public."RewardPilotAuditEvent" DROP CONSTRAINT "RewardPilotAuditEvent_target_check";
ALTER TABLE public."RewardPilotAuditEvent" ADD CONSTRAINT "RewardPilotAuditEvent_target_check" CHECK (
  ("targetType" = 'PROGRAM' AND "action"::text IN ('PROGRAM_PREPARED', 'PILOT_ACCESS_RENEWED')) OR
  ("targetType" = 'SHOP' AND "action"::text = 'SHOP_PUBLISHED') OR
  ("targetType" = 'OFFER' AND "action"::text = 'OFFER_APPROVED') OR
  ("targetType" = 'SHOPPER' AND "action"::text IN ('SHOPPER_INVITED', 'INVITATION_REISSUED', 'INVITATION_REVOKED')));
ALTER TABLE public."RewardPilotAuditEvent" DROP CONSTRAINT "RewardPilotAuditEvent_metadata_check";
ALTER TABLE public."RewardPilotAuditEvent" ADD CONSTRAINT "RewardPilotAuditEvent_metadata_check" CHECK (
  CASE WHEN "action"::text = 'PILOT_ACCESS_RENEWED' THEN
    "requestId" IS NOT NULL AND "requestId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
    public.ruvanas_rewards_pilot_renewal_metadata_valid("metadataJson")
  ELSE public.ruvanas_rewards_pilot_audit_metadata_valid("metadataJson") END);

CREATE UNIQUE INDEX "RewardPilotAuditEvent_request_key" ON public."RewardPilotAuditEvent"("organisationId", "action", "requestId");
COMMIT;
