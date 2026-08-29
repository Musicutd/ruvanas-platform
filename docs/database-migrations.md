# Database migration operations

## Stage 7A retail-media foundation

Migration `20260909000000_stage_7a_retail_media_foundation` is additive. It adds opt-in Retail Media entitlements, tenant-owned advertiser and agency records, inventory packages and targeting windows, supplier campaign orders, creative review, and subscriber approval records. Existing campaigns remain unchanged unless an order is explicitly linked; linked campaigns gain an application-level approval gate before publication.

## Stage 6B API and integrations

Migration `20260907000000_stage_6b_integrations` is additive. It adds tenant-scoped integration connections, encrypted-secret references, sync-run history, idempotent outgoing webhook events, and immutable delivery attempts. Existing organisations, playback records, campaigns, and production orders are not modified.

## Stage 6A governed AI assistance

Migration `20260906000000_stage_6a_ai_governance` is additive. It adds tenant-scoped assistant jobs, provider/provenance metadata, and human recommendation feedback. No existing content is changed and no generated artifact is connected directly to a publication or scheduling record.

## Stage 5E enterprise identity and security

Migration `20260904000000_stage_5e_enterprise_identity_security` is additive. It adds organisation security policy, identity-provider and identity-link records, service accounts, hashed API keys, revocable session metadata, and service-account audit attribution. Existing sessions receive safe defaults and existing password login remains compatible.

## Initial baseline

The migration in `prisma/migrations/20260824190000_initial_schema` creates the schema represented by `prisma/schema.prisma`. It is verified automatically against an empty PostgreSQL 16 database in CI.

Do not apply the initial migration blindly to an existing production database. It is a creation baseline, not a destructive conversion script.

## New or empty environment

1. Create an empty PostgreSQL database.
2. Set `DATABASE_URL` to that database.
3. Run `npm ci`.
4. Run `npm run db:migrate:deploy`.
5. Start the application and complete authentication, hierarchy, and media smoke tests.

## Existing environment reconciliation

1. Take and verify a restorable database snapshot.
2. Export the deployed schema and compare every table, enum, index, unique constraint, and foreign key with the initial migration.
3. Resolve every difference explicitly before continuing. Do not use `prisma db push` against production.
4. Only when the deployed schema is confirmed equivalent, mark the baseline as applied:

   `npx prisma migrate resolve --applied 20260824190000_initial_schema`

5. Run `npx prisma migrate status` and perform a staging smoke test before production rollout.

## Rollback

Prisma migrations are forward-only operationally. For a failed release:

1. Stop application writes.
2. Roll back the application release.
3. If the migration changed production data or schema incompatibly, restore the verified pre-deployment snapshot.
4. Record the incident and create a new corrective migration; never edit a migration that has already been applied.

The initial baseline only creates objects in an empty database. Its recovery path is to discard the failed empty database and recreate it. Never run a broad drop script against a database that may contain user data.


