-- RR-03b: private shopper credentials and preprovisioned invitations only.
-- No activation, credentials, tokens, membership, business accounts or backfill.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Mirrors the shared supported ASCII canonical email subset. Identity is
-- independent from business User.email and is never inferred from that table.
CREATE FUNCTION "ruvanas_rewards_email_canonical_valid"(value TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $function$
  SELECT char_length(value) BETWEEN 3 AND 254
    AND value = lower(value) AND value = btrim(value)
    AND value ~ '^[\x21-\x7e]+$'
    AND value ~ $regex$^(?!\.)(?!.*\.\.)([a-z0-9_'+\-.]*)[a-z0-9_+-]@([a-z0-9][a-z0-9\-]*\.)+[a-z]{2,}$$regex$;
$function$;

CREATE TABLE "RewardShopperCredential" (
  "shopperId" TEXT NOT NULL,
  "emailCanonical" VARCHAR(254) NOT NULL,
  "passwordHash" VARCHAR(60) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardShopperCredential_pkey" PRIMARY KEY ("shopperId"),
  CONSTRAINT "RewardShopperCredential_identifier_check" CHECK ("ruvanas_rewards_identifier_valid"("shopperId")),
  CONSTRAINT "RewardShopperCredential_email_check" CHECK ("ruvanas_rewards_email_canonical_valid"("emailCanonical")),
  CONSTRAINT "RewardShopperCredential_passwordHash_check" CHECK ("passwordHash" ~ '^\$2[ab]\$12\$[./A-Za-z0-9]{53}$'),
  CONSTRAINT "RewardShopperCredential_timestamps_check" CHECK (isfinite("createdAt") AND isfinite("updatedAt"))
);
CREATE UNIQUE INDEX "RewardShopperCredential_emailCanonical_key" ON "RewardShopperCredential"("emailCanonical");
ALTER TABLE "RewardShopperCredential" ADD CONSTRAINT "RewardShopperCredential_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "RewardShopper"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "RewardShopperInvitation" (
  "id" TEXT NOT NULL,
  "shopperId" TEXT NOT NULL,
  "emailCanonical" VARCHAR(254) NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "authVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "acceptedAt" TIMESTAMPTZ(3),
  CONSTRAINT "RewardShopperInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardShopperInvitation_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("shopperId")),
  CONSTRAINT "RewardShopperInvitation_email_check" CHECK ("ruvanas_rewards_email_canonical_valid"("emailCanonical")),
  CONSTRAINT "RewardShopperInvitation_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RewardShopperInvitation_authVersion_check" CHECK ("authVersion" >= 1),
  CONSTRAINT "RewardShopperInvitation_expiry_check" CHECK (
    isfinite("createdAt") AND isfinite("expiresAt") AND "createdAt" < "expiresAt" AND
    "expiresAt" <= "createdAt" + INTERVAL '24 hours' AND
    ("revokedAt" IS NULL OR (isfinite("revokedAt") AND "revokedAt" >= "createdAt")) AND
    ("acceptedAt" IS NULL OR (isfinite("acceptedAt") AND "acceptedAt" >= "createdAt" AND "acceptedAt" < "expiresAt")))
);
CREATE UNIQUE INDEX "RewardShopperInvitation_shopperId_key" ON "RewardShopperInvitation"("shopperId");
CREATE UNIQUE INDEX "RewardShopperInvitation_emailCanonical_key" ON "RewardShopperInvitation"("emailCanonical");
CREATE UNIQUE INDEX "RewardShopperInvitation_tokenHash_key" ON "RewardShopperInvitation"("tokenHash");
CREATE INDEX "RewardShopperInvitation_expiresAt_idx" ON "RewardShopperInvitation"("expiresAt");
ALTER TABLE "RewardShopperInvitation" ADD CONSTRAINT "RewardShopperInvitation_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "RewardShopper"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
