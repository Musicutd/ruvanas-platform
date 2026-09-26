# Ruvanas Inside — C2 facility and policy foundation

## Local implementation

Ruvanas Inside now reuses `Location` as a facility and `Zone` as a secure area. A one-to-one `CorrectionsFacility` marks only Corrections locations; a one-to-one `CorrectionsProfile` holds organisation policy. New facilities start `DRAFT`, with an `OFFLINE` first zone. No station, channel, player, AutoDJ policy or public listener is created.

The subscriber dashboard presents a short setup sequence, organisation-wide clean-only music restrictions, facility/local restrictions, youth-facility flag and secure-area creation. Its status explicitly says playback is off. Super Admin's organisation readiness list now includes Inside facility, zone and policy evidence, but never marks private delivery ready in C2.

All API access derives from the authenticated active organisation and a current Corrections entitlement. Only an owner can create facilities or set organisation policy. Owners and assigned facility managers can add secure areas and set local restrictions. C3 replaces the initial shared-branch assignment proposal with product-scoped `CorrectionsFacilityGrant` records so granting Inside access cannot accidentally grant another product's branch privileges. Other assigned members can read their facilities. Corrections facility IDs are resolved under the active organisation, and generic subscriber location/zone routes exclude Corrections facilities. Mutations have audit entries and plan-bounded counts.

The policy evaluator first requires base Ruvanas music-rights eligibility for `CORRECTIONS_RADIO`, then applies organisation and facility restrictions. It rejects missing policy, unknown/explicit content, blocked tracks/artists, restricted or disallowed genres, and youth content warnings. Its higher-level rights call requires a tenant and derives country territory from the owned facility rather than caller input. No playback route calls this yet; later C3+ work must enforce it at every actual selection, scheduling and playout boundary.

Tier provisioning caps in C2 are conservative: T1 1 facility/2 zones, T2 1/5, T3 1/15, T4 5/50, T5 5/50 pending explicit enterprise capacity controls. These are provisioning caps, not claims about live-player capacity. T5 custom expansion, facility staff assignment UI, lifecycle editing and jurisdiction-specific retention still need dedicated work.

## Database and release boundary

`20261127000000_corrections_facility_policy` adds the two policy/facility tables. It has **not** been applied to a live database. This local change has not been published or deployed. C1 migrations also remain local in this worktree. Running C2 routes against production before both C1 and C2 migrations would fail.

No Corrections playback, public link, contributor submission, Guard approval, Studio session or Secure Edge is ready. C3 (programmes and Corrections Guard) is the next specification stage; private listener output remains later still. Do not activate a Corrections station from this stage.

## Verification

- Focused C1/C2 tests: 12 passed.
- Full test suite: 922 tests, 914 passed, 8 skipped, 0 failed.
- Static integrity: passed.
- Prisma schema: valid with a placeholder database URL.
- Production build: completed with a placeholder database URL; static generation logged expected database-authentication warnings, not live database verification.
- No browser, real-audio, live migration or deployment verification was performed.
