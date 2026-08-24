# Ruvanas platform: Phase 0 audit and Phase 1 plan

Status: initial repository audit completed on 2026-08-24.

## Decision

Continue the current application through selective refactoring. Do not rebuild it from scratch.

The existing Next.js and Prisma foundation already contains useful implementations for authentication, subscriptions, organisations, brands, locations, zones, channels, stations, media storage, Centova provisioning, and public streams. The main hierarchy is compatible with the intended product direction. The immediate problem is not the framework or the core schema; it is that authorization, tenant context, migrations, tests, and operational safeguards are incomplete.

## What should be retained

- Next.js App Router application and existing user/admin screens.
- PostgreSQL and Prisma data layer.
- Database-backed, hashed session tokens and HTTP-only cookies.
- Organisation membership and role concepts.
- Organisation -> Brand -> Location -> Zone -> Channel -> Station relationships.
- Plan and subscription limit fields.
- Cloudflare R2 media storage integration.
- Centova streaming integration and encrypted station credentials.
- Audit log model and existing event writes.

## Findings

### Critical

- Several admin mutation endpoints allowed unauthenticated callers to create or change brands, locations, zones, assignments, and channels. Phase 0 now routes these operations through one server-side platform-admin guard.
- A temporary public GET endpoint provisioned a real Centova account with hard-coded test passwords. Phase 0 removes that endpoint.
- Tenant selection was implicit in several subscriber flows. Station creation selected the first membership, which is unsafe once a user belongs to multiple organisations. Phase 0 now requires an explicit organisation when multiple memberships exist and enforces the membership role.

### High priority

- The code mixes a global `User.role` with `OrganisationMember.role`. Product authorization should use the global role only for platform staff and membership roles for tenant actions.
- `lib/auth-simple.js` uses a different cookie name and compares a raw token with the HMAC token hash stored by the primary session implementation. It should be removed after confirming it has no external consumer.
- There are no committed Prisma migrations, dependency lockfile, CI workflow, environment example, or integration tests.
- `Station.slug` is globally unique while most business resources are organisation-scoped. Confirm whether public station URLs require global uniqueness before changing this.
- The application enforces one active channel per zone procedurally, but the database cannot prevent races that create multiple active assignments.
- R2 configuration is evaluated during module import, making builds and non-media processes dependent on all storage secrets being present.
- Authentication lacks rate limiting, credential-reset flows, session rotation/revocation controls, and a documented CSRF/origin policy.

### Product gaps

- No Player/device entity or player registration, heartbeat, activation, and health workflow.
- No scheduling domain for playlists, dayparts, overrides, or deterministic playout.
- Promotional media upload exists, but campaign rules, targeting, recurrence, and proof-of-play do not.
- No Ruvanas Studio workflow, analytics pipeline, billing-provider integration, invoices, or webhook processing.
- Super Admin screens are early CRUD views rather than an operational control plane.

## Work started in this change

- Add centralized platform and organisation access-control helpers.
- Protect every current admin mutation that changes the organisation hierarchy or stream configuration.
- Apply membership-role policy to subscriber station creation and protected media access.
- Return all organisation memberships from `/api/me` while retaining the original primary-organisation fields for compatibility.
- Remove the unsafe temporary provisioning endpoint.
- Add unit tests for the role matrix and a project test command.

## Implementation plan

### Phase 0A: baseline and security boundary

1. Merge the centralized authorization change after deployment smoke testing.
2. Add a committed dependency lockfile, `.env.example`, and environment validation that does not execute at import time.
3. Create the first Prisma migration from the production-compatible schema and document backup/rollback steps.
4. Add CI for dependency install, Prisma validation, tests, and production build.
5. Add route-level tests proving unauthenticated, cross-tenant, under-privileged, and platform-admin behavior.
6. Remove the duplicate session helper and document the canonical cookie/session lifecycle.
7. Add request IDs, structured security/audit events, and error monitoring.

Exit criteria: every non-public route has an explicit access policy; cross-tenant tests pass; the app builds reproducibly; migrations and rollback are documented.

### Phase 0B: canonical tenant context

1. Add an explicit active-organisation selector and persist the selection safely.
2. Replace all `findFirst` membership assumptions in pages and APIs.
3. Separate platform roles from organisation roles in code and, after data review, in the schema.
4. Define permission capabilities centrally rather than duplicating role arrays.
5. Add database constraints or transactional locking for invariants such as one active channel per zone.

Exit criteria: multi-organisation users can switch context; no request derives tenant ownership from arbitrary client input or an unordered first membership.

### Phase 1A: tenant and playback foundation

1. Confirm the canonical domain vocabulary: Channel is the programmed audio product; Station/Stream is the streaming endpoint; Player is the installed device or browser client.
2. Add Player, activation token, heartbeat, version, last-seen, and health-state models.
3. Add location/zone/player enrollment and replacement flows.
4. Add a subscriber dashboard for locations, zones, current channel, player health, and permitted media actions.
5. Add plan entitlements for locations, zones, players, storage, and features.

Exit criteria: an authorised tenant manager can create a location and zone, enroll a player, assign a channel, and observe health without platform-admin intervention.

### Phase 1B: scheduling and promotions

1. Model playlists, clocks/dayparts, schedule versions, timezone-aware rules, and overrides.
2. Model promotion campaigns, assets, target scopes, recurrence, priority, and validity windows.
3. Build deterministic schedule compilation with preview and conflict validation.
4. Record playout/proof-of-play events and expose operational diagnostics.

Exit criteria: the same schedule inputs compile deterministically; targeting is tenant-safe; every played item can be traced to its schedule decision.

## Validation notes

The role-policy unit suite passes and all server-side JavaScript files pass syntax checks. A full dependency install/build was not completed in the audit workspace because the package registry TLS chain could not be verified. The repository currently has no lockfile, so reproducible dependency resolution remains a Phase 0 requirement.

The referenced product-structure DOCX was not mounted in this workspace. This audit therefore uses the repository plus the bounded prior-conversation summary of the document. Re-run the product-gap mapping after the DOCX is attached to this task.
