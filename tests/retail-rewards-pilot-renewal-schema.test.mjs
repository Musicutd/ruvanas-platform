import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../prisma/migrations/20261221000000_retail_rewards_pilot_renewal/migration.sql", import.meta.url), "utf8");
const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
test("renewal adds a truthful audit action and scoped retry uniqueness without data or history mutation", () => {
  assert.match(migration, /ALTER TYPE public\."RewardPilotAuditAction" ADD VALUE 'PILOT_ACCESS_RENEWED'/);
  assert.match(migration, /CREATE UNIQUE INDEX "RewardPilotAuditEvent_request_key" ON public\."RewardPilotAuditEvent"\("organisationId", "action", "requestId"\)/);
  assert.match(schema, /@@unique\(\[organisationId, action, requestId\], map: "RewardPilotAuditEvent_request_key"\)/);
  const executable = migration.replace(/^--.*$/gm, "");
  assert.doesNotMatch(executable, /\b(?:UPDATE|DELETE|TRUNCATE|INSERT|DROP TRIGGER|DROP TABLE|DROP TYPE)\b/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
});
test("new enum is only used as text in same-transaction checks and old metadata restriction is retained", () => {
  assert.doesNotMatch(migration, /"action"\s*(?:=|IN)[\s\S]{0,70}PILOT_ACCESS_RENEWED/);
  assert.match(migration, /"action"::text = 'PILOT_ACCESS_RENEWED'/);
  assert.match(migration, /"targetType" = 'PROGRAM' AND "action"::text IN \('PROGRAM_PREPARED', 'PILOT_ACCESS_RENEWED'\)/);
  assert.match(migration, /ELSE public\.ruvanas_rewards_pilot_audit_metadata_valid\("metadataJson"\) END/);
  assert.match(migration, /public\.ruvanas_rewards_identifier_valid\(scalar\)/);
  assert.match(migration, /SET search_path = pg_catalog, public/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION.*pilot_audit_metadata/);
});
test("renewal SQL evidence requires exact typed non-secret metadata and a non-null UUID", () => {
  assert.match(migration, /jsonb_object_keys\(metadata\)\) <> 10/);
  assert.match(migration, /octet_length\(metadata::text\) > 2048/);
  for (const key of ["expiresAt", "previousGrantExpiry", "previousMembershipExpiry", "requestHash", "afterStateHash", "shopperId", "grantId", "membershipId", "membershipVersion", "status"]) assert.ok(migration.includes(`'${key}'`), key);
  for (const key of ["email", "tokenHash", "passwordHash", "invitationToken"]) assert.ok(!migration.includes(`'${key}'`), key);
  assert.match(migration, /"requestId" IS NOT NULL AND "requestId" ~/);
  assert.match(migration, /ELSE RETURN false/);
  assert.match(migration, /EXCEPTION WHEN OTHERS THEN RETURN false/);
});
