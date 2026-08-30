# Database migration operations

# Stage 12D Backup and Recovery Readiness

Migration `20260929000000_stage_12d_backup_recovery_readiness` adds provider-neutral recovery controls and immutable verification/restore-drill evidence for the database and protected object storage. Database checks bound RPO, RTO, retention, restore duration, evidence-field consistency, and object-versioning scope. The application records safe operational references only; it does not store backups, credentials, private provider URLs, customer content, media, or student data.

The migration is additive. An application rollback can retain both tables and their evidence because older releases do not read them. Do not remove recovery evidence during rollback. Apply only through `prisma migrate deploy` after a verified pre-migration snapshot exists for the paid production database.

## Stage 12C Operational Observability

Migration `20260928000000_stage_12c_operational_observability` adds an operational-service heartbeat register for the web application, operations worker, and optional protected-media worker. Heartbeats contain only service kind, environment, release identifiers, timestamps, an instance identifier that is hashed before display, and bounded operational details. They do not contain customer content, notification recipients, credentials, raw errors, or student data.

The migration is additive and does not change playback, schedules, publishing, delivery, billing, or tenant data. During rollback, the previous application can run with the table present. Retain heartbeat evidence until the applicable operational-retention decision is made; stop workers before any corrective schema operation.

## Stage 12B External Delivery Resilience and Recovery

Migration `20260927000000_stage_12b_delivery_resilience` adds an additive recovery counter and last-recovered timestamp to outgoing webhook events. A database check bounds the counter from zero through three. Existing events default to zero and all attempt, status and idempotency evidence remains unchanged.

The previous application can run with these fields present. During application rollback, retain them and never remove webhook attempts or reset attempt counters. Any later destructive removal requires a separately approved operational-evidence retention decision.

## Stage 11D Job and In-App Notification Foundation

Migration `20260926000000_stage_11d_job_notification_foundation` adds a PostgreSQL-backed job queue with exclusive leases, bounded exponential retries, dead-letter recovery, correlation identifiers, and safe result/error fields. It also adds tenant-scoped notification events, per-user in-app preferences, and delivery/read/dismissal evidence. The first producers are new player-offline and stream-source incidents.

The migration is additive. Email and webhook notification channels are reserved in the schema but remain disabled in the application; no external message is sent. Existing playback, schedules, manifests, proof-of-play, player commands, and stream configuration are unchanged. After job or notification evidence exists, retain these tables during an application rollback and stop the operations worker before any corrective database work.

## Stage 11C Provider-Neutral Stream Source Health

Migration `20260925000000_stage_11c_stream_source_health` adds provider/probe fields to the existing `StationStreamConfig`, creates five-minute `StationStreamHealthSample` evidence, and adds `StationStreamHealthIncident` with acknowledgement and resolution history. Existing configurations default to the compatible `CENTOVA_CAST` provider key; no data backfill or player/channel change is required.

The migration is additive. The previous application can run while the new columns and tables remain. After probe or incident evidence exists, retain it during application rollback. Destructive removal requires a separately approved operational-evidence retention decision.

## Stage 11B Controlled Player Commands and Replacement

Migration `20260924000000_stage_11b_player_commands_replacement` adds the `PlayerCommand` evidence table, command enums, nullable revocation/retirement fields, and a one-to-one player replacement link. It does not alter playback manifests, schedules, media, proof-of-play, or existing enrolment sessions.

The migration is additive. After command or replacement evidence exists, retain the table and lifecycle fields during application rollback. Destructive rollback requires a separately approved evidence-retention decision.

## Stage 11A Player Health History and Incidents

Migration `20260923000000_stage_11a_player_health_incidents` is additive. It adds five-minute player heartbeat samples and a platform-admin incident register with severity, acknowledgement, resolution, operator attribution, and historical location/zone identifiers. A partial unique index permits only one unresolved missed-heartbeat incident per player.

The migration does not change player enrolment tokens, session cookies, playback manifests, scheduling, proof-of-play, or customer content. Once operational evidence exists, retain both tables during application rollback. Before evidence exists, rollback may remove `PlayerHealthIncident`, then `PlayerHeartbeatSample`, followed by the four Stage 11A enums.

## Stage 10C School Pilot Operations and Incident Readiness

Migration `20260922000000_stage_10c_school_pilot_operations` is additive. It adds tenant-scoped supervised pilot runs and privacy-safe drill/incident evidence. It enforces valid planned windows, one active or paused pilot per organisation, and valid drill outcomes. It does not modify school content, public delivery, safeguarding, retention, or student-access data.

Before pilot evidence is accepted, rollback may remove `SchoolPilotEvent`, then `SchoolPilotRun`, followed by the six Stage 10C enums. After evidence exists, retain the tables and roll back only the application surface so operational history is preserved.

## Stage 7C Digital Signage delivery

Migration `20260911000000_stage_7c_digital_signage_delivery` is additive. It adds publishable, time-windowed visual playlists, ordered asset-to-region items, device assignments, and idempotent device-confirmed display evidence. Existing audio schedules, players, manifests, proof records, Retail Media orders, and Stage 7B visual assets/layouts/devices are not rewritten.

Rollback should be performed only before Stage 7C data is accepted. Remove the Stage 7C proof, assignment, item, and playlist tables in dependency order, then remove the two Stage 7C enums. Do not alter any Stage 7B tables during rollback.

## Stage 7B digital-signage foundation

Migration `20260910000000_stage_7b_digital_signage_foundation` is additive. It adds opt-in Digital Signage entitlements, tenant-owned visual assets, bounded reusable layouts and regions, and zone-bound display-device registrations. Existing audio players, campaigns, schedules, manifests, and proof records are not modified.

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


