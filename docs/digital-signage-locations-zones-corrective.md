# Digital Signage, Locations & Zones corrective release

## Scope

This local corrective release completes Fix 1 through Fix 7 from the approved specification. It adds no unrelated product feature, changes no billing record, and introduces no Prisma schema change or migration.

## Implemented fixes

1. Digital Signage image/video upload, layout creation, and device creation now capture a stable form reference before the first asynchronous operation. Existing playlist and takeover handlers already used the safe pattern.
2. A tenant-derived Locations & Zones service and API reuse the existing `Location` and `Zone` models. Every mutation verifies the active organisation, physical-product entitlement, current plan allowance where applicable, and organisation-owned dependencies.
3. `/dashboard/locations` gives Retail and School subscribers a guided first-location flow, requires a valid timezone and first area, and allows safe name-only renames that retain database IDs and links. Owners and Managers can change records; other organisation members have read-only access.
4. Players & Devices replaces the empty selector with the required explanation and a return-aware “Create your first location” action.
5. Digital Signage replaces the empty device selector with the required explanation and “Create location / area” action.
6. Locations & Zones appears before Players & Devices for Retail and School accounts, with direct links from both product dashboards and updated help guidance. Online-only navigation and onboarding remain independent.
7. Automated acceptance covers roles, tenant boundaries, IANA timezone validation, plan limits, audit creation, stable-reference resets, guided empty states, physical/Online product isolation, safe renaming, and a zero-billing-change integration path.

## Preserved controls

- The active organisation is always derived from the authenticated session; request bodies cannot select another tenant.
- Location creation uses the existing plan `stationLimit`, the current authoritative physical-site allowance. No new allowance or pricing rule was invented.
- Optional brands must belong to the active organisation.
- Audit details contain bounded operational names and IDs, not street-address fields.
- Player and Digital Signage APIs retain their existing enrolment, storage, publishing, proof, safeguarding, and delivery controls.
- There is no delete action. Existing player, display, schedule, proof, and campaign references therefore cannot be orphaned.
- No billing account, contract, invoice, subscription, payment-provider, or complimentary-access mutation was added.

## Deliberately absent

The current schema has no Location/Zone archive fields or archive migration. This release does not invent one. Deletion and archival remain unavailable to subscribers; a future separately approved lifecycle design would need to account for all existing dependencies.

## Verification and release gate

- Focused Locations & Zones, navigation, and help tests: passed.
- Full local unit/source suite: passed (705 tests, 8 pre-existing environment-dependent skips).
- Static integrity gate: passed.
- Prisma schema validation: passed; no migration generated.
- Optimized Next.js production build: passed.
- Full database-backed integration and browser E2E require a disposable PostgreSQL database plus local application/worker environment. The route integration scenario is implemented but must be executed in that environment before publication.
- Manual browser acceptance must still exercise Retail and School: location → area → player enrolment → Digital Signage device → image/video upload → layout → playlist → publish → signage enrolment → playback. Online-only must remain unblocked.

Do not publish, merge, or deploy until the remaining database-backed and browser acceptance evidence passes and the user gives explicit approval.
