# Ruvanas Retail Rewards: disabled policy and database foundation

## Decision and current milestone

RR-01a implements policy foundations for the optional Retail Rewards add-on inside the existing application. It follows the RR-00 assessment of repository HEAD `7a6dae34e6fe02614501a2c38ea02b61710dff0b` and the Ruvanas Retail Rewards implementation specification v1.0. The owner has authorized publishing and deploying RR-01a, subject to its review, CI, hosting and release checks. That authorization is not evidence that publication or deployment has completed.

RR-01b is authorized for local implementation and isolated testing. This worktree contains four candidate Prisma models, an additive migration, a read-only database adapter and a narrow server access wrapper alongside RR-01a. Production migration history and rollout prerequisites remain unverified. RR-01b is not authorized for production migration, deployment or activation by this local milestone.

The module lives in `lib/retail-rewards/`. It supplies strict configuration parsing, validated projections, entitlement decisions, action/location authorization, stable domain errors, advisory capacity arithmetic and read-only tenant-filtered loading. It is not an operational coupon service. Parsing a projection does not establish its provenance, authenticate a request or prove that the underlying records are current.

No route consumes the new wrapper. There is no live grant, tenant backfill, merchant activation, billing integration, navigation item, consumer claim or audio integration. No existing Retail plan, music right, catalogue tier, promotion schedule, player, stream or private-preview boundary is expanded. Nothing in this document authorizes changing production deployment policy.

## Feature and commercial boundaries

`readRewardsFeaturePolicy` reads an explicitly supplied environment projection, never process state at module import. `RUVANAS_RETAIL_REWARDS_ENABLED` and `RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED` default off. Configuration accepts only the exact strings `true` and `false`; a missing value is disabled. Truthy values such as `1`, `TRUE`, whitespace-padded values and other malformed input must not enable access. Either malformed flag disables both decisions. The public-claims decision also requires the main flag; it creates no public route or claim operation. Keep this server policy separate from browser state and from entitlement: a feature flag cannot issue a commercial grant.

The implemented access preflight requires all of the following; future request handlers must use it without weakening these checks:

1. The applicable server feature gate permits the operation.
2. A freshly authenticated, unrevoked and unexpired session identifies the current user and exact active organisation.
3. A current membership belongs to that user and that exact organisation.
4. The existing subscription is currently eligible for Retail and is bound to the explicit Rewards grant's subscription identity.
5. An unrevoked, effective, unexpired `MANUAL_INTERNAL` grant explicitly grants `RETAIL_REWARDS`, with an accepted tier and complete limits.
6. The same organisation has an `ACTIVE` Rewards program.
7. The requested action and location scope pass the Rewards permission policy.

The current policy admits only `ACTIVE` or `TRIAL` subscription/grant states. Missing or malformed grants, mismatched tenants/subscriptions, disabled or paused programs, revoked grants, future starts, expired grants and other commercial states deny access. No indefinite `PAST_DUE` grace is inherited from legacy billing behavior. A future redeem-only lapse policy requires an independently reviewed contract before claims can be issued.

The tier identifiers `REWARDS_STARTER`, `REWARDS_PRO`, `REWARDS_BUSINESS` and `REWARDS_ENTERPRISE` identify the proposed add-on. They neither replace Retail plans nor imply approved prices or numeric allowances. Every internal grant must explicitly supply `activeOffers`, `locations`, `staffSeats`, `monthlyRedemptions`, `analyticsRetentionDays`, `exportEnabled` and `brandingEnabled`. There are no guessed tier defaults or unlimited-use promises. Validation bounds are technical input constraints, not a commercial catalogue.

Neither RR-01a nor RR-01b issues these grants. The RR-01b adapter reads current internal grants with explicit expiry; a write service and a paid billing projection remain separate milestones. Existing complimentary access, a private-preview test tier, or a platform administrator role never supplies the independent Rewards grant or activates a program.

## Action and location authority

Rewards uses the existing organisation membership roles without adding a global cashier role. Role ceilings restrict what a Rewards staff grant can authorize; a grant can reduce permission but cannot exceed its holder's current role ceiling.

| Current organisation role | Maximum Rewards actions | Staff grant requirement |
| --- | --- | --- |
| `OWNER` | `READ`, `MANAGE_OFFERS`, `PUBLISH_OFFERS`, `REDEEM`, `REVERSE`, `VIEW_INSIGHTS`, `EXPORT`, `MANAGE_STAFF` | No separate staff grant; all other access checks still apply |
| `MANAGER` | All listed actions except `MANAGE_STAFF` | Explicit current grant for the requested action |
| `CONTENT_EDITOR` | `READ`, `MANAGE_OFFERS`, `VIEW_INSIGHTS` | Explicit current grant for the requested action |
| `VIEWER` | `READ`, `REDEEM` | Explicit current grant for the requested action |

Every non-owner grant must belong to the current organisation membership and tenant, be effective and unexpired, be unrevoked, and carry the requested capability. Unknown roles and actions deny access. Capabilities are separate: permission to edit an offer does not imply publication, and redemption does not imply reversal or reporting.

Each policy grant explicitly declares either `ALL_LOCATIONS` or a nonempty set of location identifiers. RR-01b stores one location per current staff-grant row and maps it to `[locationId]`; an all-location row maps to `[]`. The policy combines only grants relevant to the requested action. For example, a member with `READ` at shop A and `REDEEM` at shop B may not redeem at shop A by combining unrelated grants. Composite foreign keys require grant-scoped locations to belong to the grant's organisation. A supplied location must also pass the requested action's scope and active-location checks.

`REDEEM` and `REVERSE` always require an explicit active Location belonging to the active tenant, including for an owner or an all-locations grant. A Zone, device, guessed identifier or location owned by another tenant cannot substitute. This milestone does not reserve a staff seat or location allowance when it evaluates authorization.

Successful authorization returns a scope obligation for the caller. It is not evidence that arbitrary later data has been authorized. Every list, count, export, resource lookup, join, cache key and mutation must apply both tenant and returned action-specific scope. Requests concerning multiple target stores must check every target; a single matching store is insufficient. Tenant-only scope is not adequate for a location-limited manager's report.

## Implemented read-only adapter

`createRewardsDatabaseAdapter(db)` accepts a trusted Prisma client or transaction and constructs the RR-01a loader dependencies without querying. It has no writes, provisioning fallback, public request parameters or environment side effects. Its implemented boundaries are:

- `loadRewardsState` filters the program by organisation and the grant by both organisation and subscription. Explicit selects are validated before flat limit columns become the nested policy projection. Unknown `limitsVersion` values, malformed types or conflicting identities fail closed. Missing rows return absent authority and create nothing.
- `loadStaffGrants` filters by organisation and membership. It requests at most 1,001 rows, rejects results exceeding the policy's 1,000-row bound, and validates each row's identity, scope, capabilities and dates. It never silently truncates authority.
- `loadLocation` filters by organisation, location ID and `ACTIVE` status. Absent, foreign and inactive locations produce the same unavailable-location result.
- `requireRetailRewardsServerAccess` supplies existing `getActiveOrganisationContext` authentication with subscription, plan and billing-contract includes, together with the server environment and read-only adapter. The policy feature gate executes before authentication or database loaders are called.
- The existing authenticated subscription object is preserved. The RR-01a guard rejects the context helper's generic fallback when it does not match the session's exact selected tenant, applies role ceilings, and returns the action-specific location scope.
- Database and validation exceptions become the existing sanitized policy denial. No unrestricted cached result is substituted.

There is no implicit `SUPER_ADMIN`, support, preview or test-account bypass. The current access preflight accepts only ordinary `PASSWORD` or `SSO` session methods and rejects accounts carrying private-preview access, even when the supplied session method claims to be ordinary. A platform role cannot replace an active tenant membership or Rewards grant. Any future support or preview authority needs a separate reviewed, expiring, tenant-scoped and audited design. The existing private-preview allowlist remains unchanged; these policy functions do not make new routes reachable or authorize modifying that allowlist.

The wrapper is server infrastructure only and has no route consumer in this milestone. Future services must enforce the returned scope adjacent to their queries rather than treating an allowed preflight as authority for arbitrary records. A caller must never reconstruct an authenticated subscription from request JSON. Isolated adapter tests verify filters and projection handling; real PostgreSQL and authenticated HTTP tests have separate verification obligations.

## Candidate additive database foundation

The candidate migration is `prisma/migrations/20261211000000_retail_rewards_foundation/migration.sql`, ordered after `20261210000000_catalogue_all_tiers` in this worktree. This ordering label does not prove what production has applied. The migration uses an explicit transaction, adds new tables/types/functions/indexes and foreign keys, and performs no tenant backfill or activation.

| Model | Foundation contract |
| --- | --- |
| `RewardProgram` | One per organisation; status defaults to `DISABLED`, `networkOptIn` to `false`. Timezone is stored for later use. The network flag exposes no marketplace feature. |
| `RewardEntitlementGrant` | One current grant per organisation, bound to the same tenant's subscription through a composite FK. Status defaults to `DISABLED`; tier, dates and every numeric/boolean allowance are explicit. Source, capability and limits version have SQL checks matching the policy. |
| `RewardStaffGrant` | One current row per membership/location, plus at most one `ALL_LOCATIONS` row per membership. SQL requires a null location only for all-location scope and a real same-tenant location otherwise. Capabilities are nonempty, unique, non-null enum values. |
| `RewardAuditEvent` | Immutable tenant-owned evidence with bounded action/target enums, historical actor identifiers and an allowlisted JSON metadata object. UPDATE, DELETE and TRUNCATE are rejected. No reset bypass is provided. |

Three narrow unique keys on existing `OrganisationMember`, `Subscription` and `Location` pairs `(id, organisationId)` support the new tenant composite FKs. Existing primary keys already make these pairs unique. The new indexes still have build and locking costs requiring production review; this milestone does not alter existing row values or entitlements.

SQL rejects infinite timestamps, invalid grant windows, unsupported authority/version values, negative or oversized limits, invalid scope combinations, duplicate all-location rows and malformed capability arrays. Numeric limits are bounded to `0..1,000,000,000`, matching the policy's technical validation range; that range is not a purchased allowance. All capabilities on one staff row share its validity window. Future staff-seat accounting must count distinct members, not location-grant rows.

Audit metadata permits only bounded `before`/`after` foundation-policy snapshots and an explicit reason-code vocabulary. It accepts no arbitrary request body, free-text note, contact details or secret field. Actor and target IDs are historical scalar references rather than mutable user FKs. A future mutation service must validate those references and insert evidence in the same transaction as its change; the database alone does not establish that an actor reference was authenticated.

Membership deletion cascades to current Rewards staff grants, preserving the existing team-removal flow. It does not modify audit evidence. Location deletion is restricted while staff grants refer to it; organisation and subscription deletion are also restricted where Rewards dependencies remain. Archiving and a reviewed offboarding process must preserve evidence rather than widening a location scope through `SET NULL`.

The current regenerated-client reset discovers new organisation-scoped models. Empty Rewards tables do not change its delete behavior. Once audit evidence exists, its delete attempt is rejected and the reset transaction must roll back. A previous application/client that does not know these models can still operate with empty additive tables; if Rewards records exist, database FKs or audit protection can safely refuse its destructive reset. A rollback is not a promise that an older reset can erase new Rewards data. These cases require isolated execution tests, not just schema inspection.

## Preflight, quotas and transaction boundary

`checkRewardsCapacity` is advisory arithmetic over supplied usage and explicit grant limits. Its success neither reads current usage nor reserves capacity. It cannot establish race safety for publishing, adding a staff member or location, issuing a claim, or redeeming a coupon.

Authorization is also a preflight decision. A later operation must not rely on an earlier allowed result after membership, session, program, grant or location state changes. RR-03 must recheck current authority and eligibility inside the mutation transaction, alongside the claim transition, idempotency operation, usage counters, unique redemption and append-only audit event. Earlier milestones must use appropriate transactional enforcement for any quota-consuming operation they introduce.

Do not hold a transaction open while calling external providers. Reuse `lib/transaction-retry.mjs` for bounded serializable conflict retries where appropriate, and verify with concurrent PostgreSQL connections. Mocked policy tests cannot prove one committed redemption per claim or an offer-wide cap under concurrency.

Outstanding consumer claims do not exist in RR-01a or RR-01b. Before RR-03, approve separate policies for ordinary pause/lapse, emergency disablement, claim reservation/expiry, reversals and issued immutable terms. A global emergency disable must reject new Rewards operations while retaining records; honoring prior consumer obligations requires an explicit incident procedure rather than silently bypassing the flag.

## Requirement and verification map

The following are required checks and review obligations, not a claim that a test or release gate has passed. Record actual commands and results in each milestone's evidence. RR-00 baseline findings, RR-01a release evidence and RR-01b local verification remain separate.

| Requirement | RR-01a policy evidence | Later integration evidence |
| --- | --- | --- |
| Default off and strict configuration | Missing/false/true/malformed flag cases; deterministic safe denial | Direct routes and APIs deny disabled access; ordinary Retail never queries Rewards tables while disabled |
| Independent Retail add-on | Missing/foreign/expired/revoked grants; program states; subscription identity and current Retail eligibility; malformed projections | Trusted database adapter; no live entitlement from test-tier, complimentary or admin shortcuts |
| Explicit commercial limits | Complete bounded limit input; zero limits; export/retention restrictions; capacity boundaries and overflow handling | Atomic usage enforcement and reconciliation; approved commercial limits |
| Exact active tenant | Session/user/membership mismatches, missing selection, expired/revoked sessions, stale authority and foreign organisation | Real authenticated HTTP requests and database-backed tenant isolation |
| Least-privilege staff access | Every role/action; missing/revoked/expired staff grants; role ceilings; action-specific scope | Query-level list/export/mutation scoping and grant revocation during operations |
| Location boundary | Active same-tenant location for redeem/reverse; foreign/missing/inactive location; explicit/all-location scope | Composite tenant foreign keys and multi-location target checks |
| No side effects | Policy evaluation does not mutate caller inputs or create records; dependency boundaries remain isolated | No Rewards effect on playback, subscriptions, promotions, preview routes or other pillars |
| Redemption correctness | Explicitly outside this milestone | Real PostgreSQL duplicate/cap races, idempotency conflicts, mid-transaction failure and reversal tests |

Focused coverage belongs in `tests/retail-rewards-feature-policy.test.mjs`, `tests/retail-rewards-contracts.test.mjs`, `tests/retail-rewards-entitlements.test.mjs`, `tests/retail-rewards-access.test.mjs` and `tests/retail-rewards-database-adapter.test.mjs`. Review the implemented assertions, not just filenames or counts. Run applicable static checks, existing regression tests and a production build. Do not relabel a known baseline failure as a Rewards regression or suppress it to obtain a green report; preserve and disposition it with evidence.

RR-01a needs no database connection, migration replay, live service or browser activation. RR-01b's database verification must use an owned disposable loopback cluster with synthetic data, clean environment and verified database/user/port/data-directory identity before writes or shutdown. Never use the running local service, production credentials or the production migration target for these tests.

Required RR-01b execution evidence includes fresh full migration replay, a populated predecessor-to-candidate upgrade, unchanged predecessor rows, empty/default-off new tables, direct SQL tenant/constraint rejection, immutable audit UPDATE/DELETE/TRUNCATE rejection, membership cascade with retained evidence, current/previous-client reset compatibility and rollback on protected evidence. Exercise the real Prisma adapter against these fixtures in addition to mocked query-shape tests. Record cleanup of the owned cluster. Local PostgreSQL 18 evidence does not replace the repository's PostgreSQL 16 CI checks. Redemption concurrency remains outside this foundation because no redemption operation exists yet.

Repository CI and final acceptance remain mandatory before a release. Local tests, schema validation and a successful build do not establish production migration compatibility, live activation or deployment success.

## Subsequent milestones and approval gates

| Milestone | Required scope and exit evidence |
| --- | --- |
| RR-01b — current local candidate | Additive grant/program/staff/audit models and SQL, read-only adapter and isolated tests. Complete replay, upgrade and old-application compatibility evidence; review production prerequisites before requesting a separate schema release. No tenant backfill or activation. |
| RR-02 | Offer drafts, immutable revisions and target stores, approved publication semantics, optimistic conflicts, offer quota enforcement and merchant UX. |
| RR-03 | Claims and rotating redeem credentials, transactionally rechecked authority, atomic limits, idempotency, unique successful redemption, reversal history, concurrency tests and cashier workflow. |
| RR-04 | Minimal public merchant offers/QR, narrowly reviewed public routing, claim privacy, rate limits, mobile and keyboard/manual accessibility. Public claims remain unavailable until this work is approved. |
| RR-05 | Reproducible claims/redemption reporting, scoped safe CSV, independently gated Retail card/navigation and disabled-mode core regressions. |
| RR-06 | Optional same-tenant approved Campaign link with pinned attribution; no schedule/publication/audio mutation and no conversion claim from proof-of-play. |
| RR-07 | Internal operational evidence, measured capacity/latency, merchant usability, incident/recovery procedures, legal/commercial approval and explicit pilot go/no-go. |

Preserve December 2026 Retail and January 2027 commercial launch priorities. No Rewards dependency may block their critical path. Shared discovery, loyalty, consumer accounts, POS automation, paid billing activation and signage delivery require their own approval. Retail currently blocks digital signage in its entitlement resolver; a printable QR does not authorize changing that rule.

## Review, rollback and release boundary

For RR-01a, review the module's imports, strict input/error handling, role/action matrix, exact-tenant checks, scope contract and absence of runtime consumers. A rollback removes the isolated policy files, focused tests and this document if needed; there is no database state to undo and no live grant to revoke. Preserve unrelated working-tree changes, including the migration already modified before this milestone.

Before any RR-01b production release, verify exact predecessor migration history and checksums, deployment database identity, backup/recovery evidence, SQL lock/index-build impact and compatibility with the previous application. These production prerequisites remain pending in this local candidate. A later rollback disables the feature and restores only a schema-compatible application while retaining additive tables and immutable history. Never delete evidence or rewrite applied migrations to undo a release.

Keep required review/CI, protected-main controls and the current Auto-Deploy policy. Verify the release base and destination remote before pushing; the working Retail branch and GitHub `main` are not interchangeable. Existing runbooks keep the legacy free staging service suspended; use disposable local/CI validation and a separately authorized isolated target rather than resuming it. RR-01a publication/deployment has owner authorization, but its completion must be independently recorded. RR-01b production migration/deployment, live Rewards activation, paid subscription changes and budget increases remain outside this local milestone's authorization.

Related repository boundaries: `docs/runbooks/release-verification.md`, `docs/runbooks/final-launch-handover.md`, `lib/final-platform-acceptance.mjs`, `lib/private-preview-tester-policy.mjs`, `lib/entitlements.mjs` and the existing Retail Control Centre. The RR-00 assessment supplies the fuller threat model and product decisions; those unresolved decisions remain gates for their dependent milestones.
