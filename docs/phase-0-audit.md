# Ruvanas platform: Phase 0 audit and implementation plan

Status: full repository and product-structure audit completed on 2026-08-24.

## Sources reviewed

- The complete `Musicutd/ruvanas-platform` repository as it existed before Phase 0 work.
- `Ruvanas_Complete_Platform_Product_Structure.docx`, prepared 22 August 2026.
- The Phase 0 access-control and delivery-baseline changes on this branch.

The product document is a strategy and architecture reference rather than a final build specification. Its product principles, hierarchy, roles, phases, security requirements, and conceptual models are treated as the direction of travel. Commercial, legal, territorial, tax, rights, and pricing claims still require explicit business confirmation.

## Decision

Continue the existing application through selective refactoring. Do not rebuild it from scratch.

The Next.js, PostgreSQL, and Prisma foundation is compatible with the proposed Retail Audio Operating System. It already has useful authentication, organisations, memberships, plans, subscriptions, brands, locations, zones, channels, stations, media, stream provisioning, and audit concepts. Replacing it would discard working domain code without solving the real gaps: server-side tenant isolation, scoped roles, centralized entitlements, migrations, operational reliability, and the missing product domains.

A full restart should be reconsidered only if production data proves that tenant ownership cannot be migrated safely, or if the deployed schema differs materially from the repository.

## Locked vocabulary

- **Organisation** is the tenant and billing/security boundary.
- **Brand** belongs to an organisation and groups locations.
- **Location** is a physical site and the primary recurring billing unit.
- **Zone** is an independently controlled audio area within a location.
- **Channel** is the customer-facing programmed audio product assigned to zones.
- **Stream source** is the technical delivery endpoint behind a channel and is normally hidden from subscribers.
- **Player** is the registered browser or device that plays a zone's assigned channel and reports health.
- **Station** is currently used by the code for a provisioned stream endpoint. Keep it temporarily, then migrate or clarify it as `StreamSource` so it is not confused with the product's curated station concept.

## What should be retained

- Next.js App Router application and current subscriber/admin screens.
- PostgreSQL and Prisma data layer.
- Database-backed, hashed session tokens and HTTP-only cookies.
- Organisation membership and role concepts.
- Organisation -> Brand -> Location -> Zone -> Channel relationships.
- Existing station/stream provisioning and encrypted credentials.
- Plan and subscription limit fields as inputs to a centralized entitlement service.
- Cloudflare R2 media storage integration.
- Audit log model and existing event writes.

## Requirements traceability

| Product domain | Current coverage | Decision / next increment |
| --- | --- | --- |
| Identity and tenancy | User, Organisation, OrganisationMember, Session exist | Retain; finish explicit tenant context, tenant-safe queries, session lifecycle, MFA/SSO roadmap |
| Organisation hierarchy | Brand, Location, Zone exist | Retain; add LocationGroup, GroupMembership, OpeningHours |
| Roles and scopes | Global and membership roles exist; scopes are coarse | Separate platform roles from tenant roles and add role + scope permissions |
| Plans and entitlements | Plan and Subscription exist; checks were scattered | Centralize status, limits, and feature resolution; add complete five-tier catalog |
| Channel/stream abstraction | Channel, Station, StationStreamConfig, ChannelAssignment exist | Clarify Channel vs StreamSource vs curated Station; hide technical streams from subscribers |
| Player/device | Missing | Add registration, activation, persistent identity, heartbeat, version, replacement, and health |
| Radio programming | Station and media concepts are partial | Add MusicMode, Track, curated Station, StationTrack, MusicSchedule, ScheduleSlot, TrackBlock |
| Promotion library | MediaAsset covers uploads | Add PromoAsset/PromoVersion semantics, validation, versioning, retention, and content status |
| Campaigns and targeting | Missing | Add Campaign, CampaignTarget, CampaignSchedule, CampaignRule, preview/conflict validation |
| Ruvanas Studio | Retail ProductionOrder foundation complete through credits and promo handoff | Continue with automated audio processing, then School Programme/Episode and AudioLab milestones |
| Proof of play | PlayoutEvent is an early foundation | Separate scheduled intent from confirmed playback; support idempotent event ingestion |
| Player/stream health | Missing | Add PlayerHeartbeat, HealthIncident, classifications, alert routing, and diagnostics |
| Compliance | Missing | Add consent, policy acceptance, retention, data requests, rights metadata, and append-only evidence |
| Billing | Plan/Subscription only | Add provider customer/subscription/invoice/webhook records and entitlement reconciliation |
| Super Admin operations | Early CRUD exists | Build tenant support, production, health, incidents, credits, billing, and audit control plane |
| Notifications/support | Missing | Add notification preferences/events, SupportTicket, notes, assignments, and SLA state |
| API/jobs/reliability | Route handlers exist; no job foundation | Add versioned APIs, idempotency, queues, retries, dead-letter handling, request IDs, and structured logs |
| Internationalisation | Missing | Store location timezones and locales first; make schedules DST-safe; add translation later |

## Critical findings and Phase 0 work completed

- Centralized server-side platform and organisation access-control helpers now protect current mutations and subscriber content operations.
- Only the platform Super Admin role may override tenant membership. Support and Production staff no longer receive an implicit cross-tenant content bypass.
- Tenant selection no longer silently chooses the first membership when a user belongs to multiple organisations.
- The temporary public endpoint that provisioned a real stream account with hard-coded test credentials was removed.
- Plan status, limits, and features now resolve through one entitlement module. Station and media routes require an enabled subscription and no longer use permissive fallback limits.
- Brand, location, zone, channel, channel assignment, activation, station, and media mutations now write audit records in their database transaction.
- Environment requirements are documented and validated lazily; CI validates Prisma, syntax, tests, and production build.

## Remaining Phase 0 risks

- The initial migration and dependency lockfile are now committed and verified against clean PostgreSQL in CI. An existing deployed database still requires the documented baseline-reconciliation procedure before migration history is adopted.
- Route-level integration tests must prove unauthenticated, cross-tenant, under-privileged, and platform-override behavior against a test database.
- `lib/auth-simple.js` duplicates the canonical session implementation with incompatible token handling and should be removed after confirming no external dependency.
- Authentication still needs rate limiting, credential recovery, rotation/revocation controls, and a documented origin/CSRF policy.
- R2 configuration is evaluated during module import and should become lazy to keep unrelated processes independent of storage secrets.
- One active channel per zone is enforced procedurally, not by a database invariant or sufficiently strong transactional lock.
- Upload validation needs file-signature inspection, malware scanning, quarantine, and safe media processing.
- Audit storage is mutable in the current relational model; compliance-grade append-only export or controls are still required.

## Implementation plan

### Phase 0A: secure, reproducible baseline

1. Merge centralized authorization, entitlements, and audit coverage after deployment smoke testing.
2. Add a dependency lockfile and the first production-compatible Prisma migration, with backup and rollback notes. **Completed in the draft PR.**
3. Add route-level tenant-isolation tests and a safe seeded test database.
4. Remove the duplicate auth helper and document the canonical cookie/session lifecycle.
5. Add rate limits, origin protections, request IDs, structured logging, and error monitoring.
6. Make storage configuration lazy and add upload validation/quarantine.

Exit criteria: every non-public route has an explicit policy; cross-tenant tests pass; builds and migrations are reproducible; rollback is documented.

### Phase 0B: canonical tenant context and invariants

1. Add an explicit active-organisation selector and persist it safely.
2. Remove remaining unordered `findFirst` membership assumptions.
3. Separate platform roles from organisation roles and introduce centrally defined capabilities and scopes.
4. Add database/transaction protections for one active assignment and other tenant invariants.
5. Define audit retention and append-only export controls.

Exit criteria: multi-organisation users can switch safely; no request trusts arbitrary tenant ownership; hierarchy mutations are fully attributable.

### Phase 1: core platform

Deliver the document's core scope: organisations, users, scoped roles, brands, locations, location groups, zones, channels, stream sources, players, entitlements, and audit. Start with an authenticated web player using a persistent player ID and heartbeat, then extend to dedicated device clients. The first end-to-end milestone is: create hierarchy -> enrol player -> assign channel -> play -> observe heartbeat and health.

### Phase 2: radio control

Add music modes, track catalog, curated stations, station tracks, deterministic timezone-aware schedules, schedule slots, blocks, preview, versioning, and DST tests.

### Phase 3: promotions

Add versioned promo assets, campaigns, targets, schedules, recurrence and priority rules, deterministic compilation, playback confirmation, and proof-of-play reporting.

### Phase 4: Ruvanas Studio

Add production orders, briefs, script versions, previews, revision workflow, approvals, delivery, and production-credit ledger.

### Phase 5: analytics and enterprise

Add operational and content analytics, billing-provider reconciliation, invoices, SSO foundations, compliance workflows, support tooling, exports, and enterprise controls.

### Phase 6: AI and integrations

Introduce recommendation and automation features only behind reviewable workflows, alongside documented APIs, webhooks, and integrations.

### Phase 7: retail media and signage

Extend the proven tenant, targeting, scheduling, player-health, and reporting foundations to signage and broader retail-media inventory.

## Recommended product defaults

- Use the tier names **Start, Business, Pro, Brand, Enterprise**.
- Bill primarily per location, with an included zone allowance and paid additional zones.
- Ruvanas operations manage technical stream sources; subscribers manage permitted content, campaigns, and schedules.
- Begin player delivery with an authenticated web player, persistent identity, heartbeat, and replacement flow.
- Treat Commercial Music as optional on lower tiers and a default capability from Pro upward, subject to licensing economics.
- Defer reseller/multi-client capabilities to an enterprise phase.
- Do not finalize payment provider, launch territories, tax handling, price points, music-rights claims, retention periods, or service-level commitments without commercial and legal confirmation.

## Validation notes

- Fourteen tests pass in CI, including a PostgreSQL-backed cross-tenant membership test.
- Modified server-side JavaScript passes syntax validation and the patch passes whitespace checks.
- GitHub CI passed on the implementation commit produced by this audit.
- The DOCX was inspected structurally in full: 280 paragraphs, 34 tables, 51 headings, one section, no images, comments, or tracked changes.
- Visual page rendering could not be completed in this environment because LibreOffice is unavailable and desktop Word automation is not permitted. Content, styles, tables, headers/footers, and underlying WordprocessingML were still reviewed.

