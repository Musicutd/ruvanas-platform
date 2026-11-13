# Ruvanas Retail Rewards: disabled policy foundation

## Decision and current milestone

RR-01a implements local policy foundations for the optional Retail Rewards add-on inside the existing application. It follows the RR-00 assessment of repository HEAD `7a6dae34e6fe02614501a2c38ea02b61710dff0b` and the Ruvanas Retail Rewards implementation specification v1.0. Approval covers this foundation only; RR-01b and later milestones require subsequent review and authorization.

The module lives in `lib/retail-rewards/`. It supplies strict configuration parsing, validated policy projections, entitlement decisions, action/location authorization, stable domain errors and advisory capacity arithmetic. These are policy functions, not a production authorization adapter or an operational coupon service. Parsing a projection does not establish its provenance, authenticate a request or prove that the underlying records are current.

This milestone adds no route, database adapter, Prisma model, migration, live grant, merchant activation, billing integration, navigation item, consumer claim, audio integration or deployment. No existing Retail plan, music right, catalogue tier, promotion schedule, player, stream or private-preview boundary is expanded. Nothing in this document authorizes changing production deployment policy.

## Feature and commercial boundaries

`readRewardsFeaturePolicy` reads an explicitly supplied environment projection, never process state at module import. `RUVANAS_RETAIL_REWARDS_ENABLED` and `RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED` default off. Configuration accepts only the exact strings `true` and `false`; a missing value is disabled. Truthy values such as `1`, `TRUE`, whitespace-padded values and other malformed input must not enable access. Either malformed flag disables both decisions. The public-claims decision also requires the main flag; it creates no public route or claim operation. Keep this server policy separate from browser state and from entitlement: a feature flag cannot issue a commercial grant.

The future request boundary must require all of the following:

1. The applicable server feature gate permits the operation.
2. A freshly authenticated, unrevoked and unexpired session identifies the current user and exact active organisation.
3. A current membership belongs to that user and that exact organisation.
4. The existing subscription is currently eligible for Retail and is bound to the explicit Rewards grant's subscription identity.
5. An unrevoked, effective, unexpired `MANUAL_INTERNAL` grant explicitly grants `RETAIL_REWARDS`, with an accepted tier and complete limits.
6. The same organisation has an `ACTIVE` Rewards program.
7. The requested action and location scope pass the Rewards permission policy.

The current policy admits only `ACTIVE` or `TRIAL` subscription/grant states. Missing or malformed grants, mismatched tenants/subscriptions, disabled or paused programs, revoked grants, future starts, expired grants and other commercial states deny access. No indefinite `PAST_DUE` grace is inherited from legacy billing behavior. A future redeem-only lapse policy requires an independently reviewed contract before claims can be issued.

The tier identifiers `REWARDS_STARTER`, `REWARDS_PRO`, `REWARDS_BUSINESS` and `REWARDS_ENTERPRISE` identify the proposed add-on. They neither replace Retail plans nor imply approved prices or numeric allowances. Every internal grant must explicitly supply `activeOffers`, `locations`, `staffSeats`, `monthlyRedemptions`, `analyticsRetentionDays`, `exportEnabled` and `brandingEnabled`. There are no guessed tier defaults or unlimited-use promises. Validation bounds are technical input constraints, not a commercial catalogue.

RR-01a does not issue these grants. A later trusted adapter may read approved internal grants with explicit expiry; a paid billing projection remains a separate milestone. Existing complimentary access, a private-preview test tier, or a platform administrator role never supplies the independent Rewards grant or activates a program.

## Action and location authority

Rewards uses the existing organisation membership roles without adding a global cashier role. Role ceilings restrict what a Rewards staff grant can authorize; a grant can reduce permission but cannot exceed its holder's current role ceiling.

| Current organisation role | Maximum Rewards actions | Staff grant requirement |
| --- | --- | --- |
| `OWNER` | `READ`, `MANAGE_OFFERS`, `PUBLISH_OFFERS`, `REDEEM`, `REVERSE`, `VIEW_INSIGHTS`, `EXPORT`, `MANAGE_STAFF` | No separate staff grant; all other access checks still apply |
| `MANAGER` | All listed actions except `MANAGE_STAFF` | Explicit current grant for the requested action |
| `CONTENT_EDITOR` | `READ`, `MANAGE_OFFERS`, `VIEW_INSIGHTS` | Explicit current grant for the requested action |
| `VIEWER` | `READ`, `REDEEM` | Explicit current grant for the requested action |

Every non-owner grant must belong to the current organisation membership and tenant, be effective and unexpired, be unrevoked, and carry the requested capability. Unknown roles and actions deny access. Capabilities are separate: permission to edit an offer does not imply publication, and redemption does not imply reversal or reporting.

Each grant explicitly declares either `ALL_LOCATIONS` or a nonempty set of location identifiers. Resolve location scope separately for the requested action. For example, a member with `READ` at shop A and `REDEEM` at shop B may not redeem at shop A by combining unrelated grants. Every location used by the eventual adapter must belong to the active organisation. A supplied location for a scoped operation must pass that operation's scope check.

`REDEEM` and `REVERSE` always require an explicit active Location belonging to the active tenant, including for an owner or an all-locations grant. A Zone, device, guessed identifier or location owned by another tenant cannot substitute. This milestone does not reserve a staff seat or location allowance when it evaluates authorization.

Successful authorization returns a scope obligation for the caller. It is not evidence that arbitrary later data has been authorized. Every list, count, export, resource lookup, join, cache key and mutation must apply both tenant and returned action-specific scope. Requests concerning multiple target stores must check every target; a single matching store is insufficient. Tenant-only scope is not adequate for a location-limited manager's report.

## Future trusted adapter contract

RR-01b must add a narrowly scoped server adapter, rather than accepting policy projections from request JSON or spreading the generic administration bypass into Rewards. It must:

- Load the current session through existing authentication, validate revocation/expiry and applicable account policies, and use the actual authenticated user identity.
- Require an exact match between the session's selected active organisation and the current membership. Do not accept the generic context fallback to another membership as authority for a Rewards operation.
- Load the subscription, independent Rewards grant, program, membership and required staff grants from trusted records for that tenant. Check all foreign-reference relationships, not merely the presence of separate identifiers.
- Load requested and grant-scoped locations under that tenant, and require an active location for redemption/reversal. Bound grant and location reads.
- Apply role ceilings and return the action-specific scope with the result. Keep scope enforcement adjacent to the subsequent query or service operation so it cannot be accidentally discarded.
- Fail closed on missing, stale, inconsistent or unavailable authority. Do not turn a database failure into a successful policy result or a cached unrestricted response.

There is no implicit `SUPER_ADMIN`, support, preview or test-account bypass. The current access preflight accepts only ordinary `PASSWORD` or `SSO` session methods and rejects accounts carrying private-preview access, even when the supplied session method claims to be ordinary. A platform role cannot replace an active tenant membership or Rewards grant. Any future support or preview authority needs a separate reviewed, expiring, tenant-scoped and audited design. The existing private-preview allowlist remains unchanged; these policy functions do not make new routes reachable or authorize modifying that allowlist.

The adapter must preserve the existing server-resolved Retail eligibility semantics while rejecting malformed policy inputs. A caller must not reconstruct an authenticated test-plan projection from untrusted JSON. Tests with synthetic projections validate policy behavior only; they do not prove that a future adapter loads authoritative records.

## Preflight, quotas and transaction boundary

`checkRewardsCapacity` is advisory arithmetic over supplied usage and explicit grant limits. Its success neither reads current usage nor reserves capacity. It cannot establish race safety for publishing, adding a staff member or location, issuing a claim, or redeeming a coupon.

Authorization is also a preflight decision. A later operation must not rely on an earlier allowed result after membership, session, program, grant or location state changes. RR-03 must recheck current authority and eligibility inside the mutation transaction, alongside the claim transition, idempotency operation, usage counters, unique redemption and append-only audit event. Earlier milestones must use appropriate transactional enforcement for any quota-consuming operation they introduce.

Do not hold a transaction open while calling external providers. Reuse `lib/transaction-retry.mjs` for bounded serializable conflict retries where appropriate, and verify with concurrent PostgreSQL connections. Mocked policy tests cannot prove one committed redemption per claim or an offer-wide cap under concurrency.

Outstanding consumer claims do not exist in RR-01a. Before RR-03, approve separate policies for ordinary pause/lapse, emergency disablement, claim reservation/expiry, reversals and issued immutable terms. A global emergency disable must reject new Rewards operations while retaining records; honoring prior consumer obligations requires an explicit incident procedure rather than silently bypassing the flag.

## Requirement and verification map

The following are required checks and review obligations, not a claim that a test or release gate has passed. Record actual commands and results in the milestone review. RR-00 baseline findings remain separate from RR-01a evidence.

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

Focused coverage belongs in `tests/retail-rewards-feature-policy.test.mjs`, `tests/retail-rewards-contracts.test.mjs`, `tests/retail-rewards-entitlements.test.mjs` and `tests/retail-rewards-access.test.mjs`. Review the implemented assertions, not just filenames or counts. Run applicable static checks, existing regression tests and a production build. Do not relabel a known baseline failure as a Rewards regression or suppress it to obtain a green report; preserve and disposition it with evidence.

RR-01a needs no database connection, migration replay, live service or browser activation. Future migration and HTTP tests require a verified disposable database/application. Repository CI and final acceptance remain mandatory before a release, and local policy tests do not replace them.

## Subsequent milestones and approval gates

| Milestone | Required scope and exit evidence |
| --- | --- |
| RR-01b | Reviewed additive grant/program/staff/audit schema; trusted adapter; tenant composite integrity; forward-only SQL; disposable PostgreSQL replay; old-application compatibility. No tenant backfill or activation by default. |
| RR-02 | Offer drafts, immutable revisions and target stores, approved publication semantics, optimistic conflicts, offer quota enforcement and merchant UX. |
| RR-03 | Claims and rotating redeem credentials, transactionally rechecked authority, atomic limits, idempotency, unique successful redemption, reversal history, concurrency tests and cashier workflow. |
| RR-04 | Minimal public merchant offers/QR, narrowly reviewed public routing, claim privacy, rate limits, mobile and keyboard/manual accessibility. Public claims remain unavailable until this work is approved. |
| RR-05 | Reproducible claims/redemption reporting, scoped safe CSV, independently gated Retail card/navigation and disabled-mode core regressions. |
| RR-06 | Optional same-tenant approved Campaign link with pinned attribution; no schedule/publication/audio mutation and no conversion claim from proof-of-play. |
| RR-07 | Internal operational evidence, measured capacity/latency, merchant usability, incident/recovery procedures, legal/commercial approval and explicit pilot go/no-go. |

Preserve December 2026 Retail and January 2027 commercial launch priorities. No Rewards dependency may block their critical path. Shared discovery, loyalty, consumer accounts, POS automation, paid billing activation and signage delivery require their own approval. Retail currently blocks digital signage in its entitlement resolver; a printable QR does not authorize changing that rule.

## Review, rollback and release boundary

For RR-01a, review the module's imports, strict input/error handling, role/action matrix, exact-tenant checks, scope contract and absence of runtime consumers. A rollback removes the isolated policy files, focused tests and this document if needed; there is no database state to undo and no live grant to revoke. Preserve unrelated working-tree changes, including the migration already modified before this milestone.

RR-01b must review exact predecessor migration history, SQL locks, backup evidence and compatibility with the previous application. Later rollback disables the feature and restores only a schema-compatible application while retaining additive tables and immutable history. Never delete redemptions or rewrite applied migrations to undo a release.

Keep required review/CI, protected-main controls and the current Auto-Deploy policy. The local checkout's remote must be verified before any separately authorized push. Existing runbooks keep the legacy free staging service suspended; use disposable local/CI validation and a separately authorized isolated target rather than resuming it. Deployment, live activation, paid subscription changes and cost increases are not authorized by this foundation milestone.

Related repository boundaries: `docs/runbooks/release-verification.md`, `docs/runbooks/final-launch-handover.md`, `lib/final-platform-acceptance.mjs`, `lib/private-preview-tester-policy.mjs`, `lib/entitlements.mjs` and the existing Retail Control Centre. The RR-00 assessment supplies the fuller threat model and product decisions; those unresolved decisions remain gates for their dependent milestones.
