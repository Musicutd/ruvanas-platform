# Ruvanas Inside — C0/C1 completion report

## Implemented

`CORRECTIONS` is the seventh product family. The shared plan catalogue now has 35 public plans, including five Ruvanas Inside tiers. Registration, login routing, subscriber product cards, navigation, Super Admin plan editing, QA tier evaluation, account visibility, help and a gated foundation dashboard recognize the new product. `CORRECTIONS_RADIO` is a separate rights-use identifier. Existing subscriptions do not gain Corrections automatically.

## Architecture decisions

The implementation reuses existing organisations, memberships, subscriptions, billing, plan/entitlement resolution, registration, rights metadata, music catalogue controls, Studio tier rules, Super Admin plan editor, audit conventions and product dashboard shell. No duplicate account, catalogue, scheduler, Studio or streaming subsystem was added. The threat model, reuse map and release boundary are in `docs/corrections-c0-architecture.md`.

## Database

`20261126000000_corrections_product_foundation` adds the `CORRECTIONS` and `CORRECTIONS_RADIO` enum values and nullable/default-denied capability fields. `20261126010000_corrections_public_plans` inserts five plans. PostgreSQL requires the enum value to commit before plan rows use it, hence two migrations. Existing plans and subscriptions are not rewritten. Migrations were validated against the Prisma schema, but **not applied to a database** in this local milestone.

The five new plan codes are `CORRECTIONS_ESSENTIAL` (€149), `CORRECTIONS_FACILITY` (€299), `CORRECTIONS_REHABILITATION_PRO` (€599), `CORRECTIONS_NETWORK` (€1,199) and `CORRECTIONS_JUSTICE_ENTERPRISE` (from €2,499). Catalogue levels are `NONE`, `NONE`, `FOCUSED`, `PROFESSIONAL`, `PREMIUM`. The shared rule gives Studio Basic to T1–T2 and Pro to T3–T5. Numerical station/storage/listener values are provisional commercial allowances; facility and zone caps are not yet modelled or enforced.

## Entitlements and security

`correctionsRadioEnabled` resolves from the effective plan, an explicit subscription override or a complimentary snapshot, always under the billing service state. Absent or legacy fields resolve false. The dashboard uses `requireSubscriberProduct("CORRECTIONS")`, deriving the active tenant from authenticated membership. Corrections-only navigation suppresses generic programming, Studio, media and player links until facility policy exists. Public-player publication, public station listing, public listener leases, public websites and Super Admin station activation explicitly reject Corrections. Existing nullable station product-family records remain eligible for their historical public behavior.

The rights-use label is available to Super Admin catalogue/distributor metadata, but no Corrections subscriber catalogue or playback route was opened. Licensed catalogue tier is not itself permission to play or download. Facility isolation, staff-specific roles and Corrections Guard are not falsely claimed in C1 because no facility resources or contributor sessions exist yet.

## Tests and regression

- Full unit/integration-style suite: 915 tests, 907 passed, 8 skipped, 0 failed.
- Focused product/registration suite: 55 passed.
- Static integrity: passed (1,312 files checked).
- Prisma schema: valid with a placeholder URL; no live database connection was used.
- Next.js production build: completed. Existing Studio CSS autoprefixer warning remains. Some static page generation logged expected database authentication errors because the build used a placeholder URL; this is not production database verification.
- Diff whitespace check: passed.

Retail, School, Online Radio, Health, Faith and Organisations product/registration tests passed. Public listener behavior for those six remains guarded by their existing checks; nullable legacy station family handling is preserved. There was no browser, real-audio, payment or deployed-environment verification.

## Not implemented yet

C2 facility/profile/policy and zone controls; C3 programme moderation and Corrections Guard; C4 supervised Studio/contributors; C5 requests and rehabilitation workflows; C6 announcements/emergency overrides; C7 network governance; C8 Secure Edge; C9 hardening and launch acceptance. No Corrections audio should be activated until the relevant private-delivery and policy gates are complete.

## Next recommended stage

Implement C2 as a small, separate change: Corrections profile, facility ownership and zone mapping, explicit policy, prohibited content rules, and server-side tenant/facility permission tests. Keep playback and public delivery disabled during C2. Do not deploy C1 as a usable prison-radio service.

## Files created

- `app/dashboard/corrections/page.js`
- `docs/corrections-c0-architecture.md`
- `docs/corrections-c1-completion.md`
- `prisma/migrations/20261126000000_corrections_product_foundation/migration.sql`
- `prisma/migrations/20261126010000_corrections_public_plans/migration.sql`
- `tests/corrections-foundation.test.mjs`

## Files modified

- `app/admin/organisations/page.js`
- `app/admin/plans/PlanCatalogueEditor.js`
- `app/admin/plans/page.js`
- `app/admin/product-qa/ProductQaControlCentre.js`
- `app/api/admin/plans/[planId]/route.js`
- `app/api/admin/stations/[stationId]/activate/route.js`
- `app/api/public/stations/[slug]/route.js`
- `app/api/stations/[stationId]/public-player/route.js`
- `app/api/stations/[stationId]/website/route.js`
- `app/dashboard/page.js`
- `app/page.js`
- `app/register/RegisterJourney.js`
- `app/stations/[stationId]/public-player/page.js`
- `lib/catalogue-audience.mjs`
- `lib/complimentary-access.mjs`
- `lib/entitlements.mjs`
- `lib/media-library-pro.mjs`
- `lib/music-distributor.mjs`
- `lib/product-access.mjs`
- `lib/product-onboarding.mjs`
- `lib/product-plan-catalogue.mjs`
- `lib/product-qa-acceptance.mjs`
- `lib/product-registration.mjs`
- `lib/public-player-service.js`
- `lib/public-player.mjs`
- `lib/registration-experience.mjs`
- `lib/station-website-service.js`
- `lib/subscriber-help-centre.mjs`
- `lib/user-experience-navigation.mjs`
- `prisma/schema.prisma`
- `tests/catalogue-audience.test.mjs`
- `tests/entitlements.test.mjs`
- `tests/health-faith-expansion.test.mjs`
- `tests/organisations-expansion.test.mjs`
- `tests/product-plan-catalogue.test.mjs`
- `tests/product-qa-acceptance.test.mjs`
- `tests/registration-experience.test.mjs`
- `tests/subscriber-programming.test.mjs`
- `tests/user-experience-navigation.test.mjs`

Nothing was published or deployed for this milestone.
