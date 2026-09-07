# Stage 29R.1 Product Registration Reconciliation

## Purpose

This milestone reconciles the post-Stage-29 product-registration specification with the repository that is actually available for implementation. It establishes the safe baseline for introducing explicit Retail Radio, School Radio and Online Radio product access without duplicating existing work or treating billing state as product authorization.

No database, application or deployment behaviour changes in this milestone.

## Verified repository baseline

| Area | Verified position | Decision |
| --- | --- | --- |
| Repository | `Musicutd/ruvanas-platform` | Continue in the existing application and database. |
| Available main baseline | Merge commit `7d11fd9`, Stage 19.26 Enterprise Scale Readiness | Use this merged baseline. Do not reset to an earlier stage. |
| Stage 20–29 history | No Stage 20–29 branches, commits or documents are present in the fetched repository | Treat “Stage 29 completed” as a user-reported milestone label, not as code that can be reconciled or reused. |
| Working tree at audit start | Clean | Create additive, reviewable 29R milestones from the merged baseline. |
| Existing products | Retail, School and Online subscriber dashboards already exist | Preserve and harden them; do not fork the application. |

## Existing foundations to reuse

### Account and tenant foundation

- Registration already creates a user, organisation, owner membership, subscription and audit record in one transaction.
- Session creation, duplicate-email protection and registration rate limiting already exist.
- Organisation membership remains the tenant boundary and must not be bypassed.
- Super Admin and Support role routing must remain separate from subscriber product routing.

### Billing and entitlement foundation

- `Plan` already owns commercial limits and feature defaults.
- `Subscription` already supports nullable feature overrides.
- `resolveBillingServiceState()` already determines whether the subscription may operate.
- `resolveEntitlements()` already combines billing state, subscription overrides, plan defaults and complimentary access.
- Complimentary access already snapshots plan limits and feature flags so access can continue independently of later plan edits.

These foundations are suitable for explicit product capabilities. The new product flags must be resolved through the same precedence rules rather than through a second authorization system.

### Product and rights foundation

- Dedicated subscriber routes exist at `/dashboard/retail`, `/dashboard/school` and `/dashboard/radio`.
- The shared `/dashboard` product chooser and product-specific onboarding builders already exist.
- Music rights records already distinguish `RETAIL_RADIO`, `SCHOOL_RADIO` and `ONLINE_RADIO` uses.
- Online Radio services already apply rights-aware checks for media, smart playlists, scheduling and playout.
- School Radio already has explicit entitlement, safeguarding and controlled-publishing foundations.

The commercial Licensed Music Catalogue ladder can therefore extend the existing rights model. It must not replace use, territory, availability, clean-content or safeguarding checks.

## Confirmed gaps

| Gap | Current behaviour | Required correction |
| --- | --- | --- |
| Product capabilities | Only `schoolRadioEnabled` is explicit. Retail and Online commonly use `serviceEnabled`. | Add independent `retailRadioEnabled` and `onlineRadioEnabled` capabilities. Keep `serviceEnabled` as billing and operational state only. |
| Registration service choice | The registration page ignores `platform` and `tier` query parameters. | Add a guided product and tier choice with server-approved values. |
| Registration plan resolution | The API creates or reuses one generic `STARTER` plan and begins a 30-day trial. | Resolve `product + tier` to one active authoritative plan. Never silently fall back. |
| Pricing catalogue | The homepage contains three hard-coded tiers per product with superseded names and prices. | Introduce one five-tier source of truth for all three product families. |
| Licensed catalogue | `includesRuvanasCatalogue` is a boolean for the Ruvanas catalogue only. | Keep it separate and add `NONE`, `FOCUSED`, `PROFESSIONAL` and `PREMIUM` licensed-catalogue levels. |
| Product navigation | Retail and Online product cards and tools are often exposed through `serviceEnabled`. | Require the matching explicit product capability for every product-specific surface. |
| Login landing | Login returns the user to the general dashboard. | Route single-product subscribers to their product dashboard; retain the chooser for multi-product organisations. |
| Complimentary access | Snapshots do not preserve Retail, Online or licensed-catalogue level. | Extend snapshots and revocation handling for all three product capabilities and catalogue level. |
| Admin visibility | Organisation readiness treats Retail and Online as enabled whenever service is enabled. | Show effective product badges, source and licensed-catalogue level. |
| QA tenants | No controlled three-tenant product-isolation evidence exists. | Create three test organisations only after the entitlement and registration changes are deployed to a controlled environment. |

## Authority and naming decisions

The following fifteen plan codes become the stable public catalogue:

- Retail: `RETAIL_START`, `RETAIL_BUSINESS`, `RETAIL_PROFESSIONAL`, `RETAIL_ADVANCED`, `RETAIL_ENTERPRISE`
- School: `SCHOOL_START`, `SCHOOL_CREATE`, `SCHOOL_PRO`, `SCHOOL_ACADEMY`, `SCHOOL_ENTERPRISE`
- Online: `ONLINE_HOBBY`, `ONLINE_STARTER`, `ONLINE_PROFESSIONAL`, `ONLINE_STATION_PRO`, `ONLINE_NETWORK`

Customer-facing catalogue wording is **Licensed Music Catalogue**. Supplier identity, supplier credentials and supplier wholesale pricing remain outside subscriber-facing code and responses.

Enterprise plans are controlled. “From” or custom pricing must lead to an enquiry or Super Admin-approved activation rather than unrestricted self-service provisioning.

## 29R.2 implementation contract

The next milestone will introduce the shared product and plan foundation:

1. Add `retailRadioEnabled` and `onlineRadioEnabled` to `Plan` with conservative `false` defaults.
2. Add nullable Retail and Online overrides to `Subscription`, matching the existing School override pattern.
3. Add `LicensedMusicCatalogueLevel` with `NONE`, `FOCUSED`, `PROFESSIONAL` and `PREMIUM` values to plans and complimentary snapshots.
4. Preserve `includesRuvanasCatalogue` as a separate entitlement for Ruvanas-owned or otherwise rights-cleared content.
5. Create one server-owned fifteen-plan catalogue that supplies names, public slugs, monthly baselines, product family, tier number, limits and catalogue level.
6. Seed or upsert public plans by stable code without deleting or rewriting historical plan rows.
7. Extend `resolveEntitlements()` and complimentary access to resolve all three product flags and licensed-catalogue level through the existing precedence model.
8. Expose the new fields to Super Admin plan and organisation views with an auditable source.

`primaryProduct` is deliberately deferred. The three capability booleans are authoritative and can derive single-product versus multi-product behaviour without adding an enum that could be mistaken for authorization.

## Migration and backfill safety

- The migration is forward-only and must sort after the current migration history.
- New product capabilities default to `false` so deployment cannot grant access accidentally.
- Known future public plan codes receive exact catalogue-defined capabilities.
- Existing School capability values remain authoritative for School access.
- Legacy `STARTER`, custom and ambiguously named plans do not receive Retail or Online access automatically.
- Ambiguous subscriptions must be listed for Super Admin review before product route guards switch to explicit capabilities.
- Licensed Music Catalogue defaults to `NONE` unless a controlled entitlement proves a higher level.
- Historical billing, subscription and audit evidence is preserved.

## Route and feature guard inventory for later milestones

### Retail

The Retail dashboard, shop-player setup, retail locations, retail programming language, Retail Media and Digital Signage entry points require `retailRadioEnabled` plus any narrower feature entitlement already in force.

### School

The School dashboard and `/dashboard/school-radio/*` continue to require `schoolRadioEnabled`. Safeguarding, student access, review, publishing and education-use rights remain additional mandatory controls.

### Online

The Online dashboard, public station administration, listener analytics, station websites, networks, syndication, distribution, advertising, programme director and Online newsroom require `onlineRadioEnabled` plus their existing narrower permissions and rights checks.

### Shared

Account, team, support and genuinely shared media or production tools remain available according to their existing shared capability and role rules. Shared access must never imply ownership of all three products.

## Milestone sequence

| Milestone | Scope | Exit gate |
| --- | --- | --- |
| 29R.1 | Repository and feature reconciliation | Baseline documented; no duplicate implementation. |
| 29R.2 | Product capabilities, fifteen-plan catalogue and licensed-catalogue levels | Independent product and catalogue-level tests pass. |
| 29R.3 | Product-aware registration API | Each valid product and tier creates the correct subscription atomically. |
| 29R.4 | Guided registration experience | Direct and pricing-deep-link flows pass desktop, mobile and accessibility checks. |
| 29R.5 | Dashboard, navigation and route isolation | Wrong-product access is blocked for all three single-product profiles. |
| 29R.6 | Product-aware login routing | Single-product and multi-product login behaviour is stable. |
| 29R.7 | Three controlled QA tenants and tier switching | Tier 1–5 product, pricing and catalogue boundaries are evidenced. |
| 29R.8 | Release gate | Full suite, migration validation, build, smoke and rollback evidence pass. |

## 29R.1 exit decision

The current repository contains reusable account, billing, entitlement, product-dashboard, complimentary-access and rights foundations, but it does not contain the post-Stage-29 product-aware registration work described in the update specification. The next safe action is Stage 29R.2. No production deployment is required for this documentation-only reconciliation milestone.
