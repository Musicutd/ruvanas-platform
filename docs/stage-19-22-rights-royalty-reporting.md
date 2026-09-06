# Stage 19.22 — Rights and royalty reporting

## Outcome

Stage 19.22 adds a provider-neutral rights-reporting workspace over a new append-only music-usage ledger. Organisation owners and managers can configure reporting-authority profiles, map catalogue recordings and works to recognised identifiers, and generate sealed CSV exports for one authority, territory and reporting period.

This stage does not claim that an authority accepts an export, grant a music licence, measure audience size, or calculate money owed. Those outcomes depend on current authority specifications and commercial or legal agreements.

## Reused foundations

- Stage 19.2 remains the authority for track ownership, rights review, territory and permitted-use eligibility.
- Existing signed player proof remains the only source for enrolled-player usage.
- `ReportExportJob`, report access, audit logs and protected downloads remain the export pipeline.
- Existing organisation membership and owner/manager roles control configuration; no new role system is introduced.

## Immutable usage ledger

Only a verified `COMPLETED` music proof event creates a `RightsUsageLedgerEvent`. The event snapshots the track, rights reference, player, station, channel, territory, duration and source proof identifier. Source identifiers and the evidence hash are unique, making retries idempotent. Database triggers reject updates and deletes, and restrictive foreign keys prevent evidence-bearing source records from being removed.

Listener analytics, planned schedules, advertising estimates, starts, failures and interrupted playback never enter this ledger.

## Authority and work mapping

`RightsReportingAuthority` stores an organisation-owned authority code, territory and versioned export format without naming or coupling the platform to an external society. `RightsWorkMapping` connects an authority and catalogue track to ISRC/ISWC, composer, publisher and authority-reference data. Saving an existing mapping increments its audited revision; optional verification records the responsible user and time.

## Attested exports

Exports are limited to 366 days and 250,000 ledger events. They include only the selected organisation and the authority's territory. CSV cells are protected from formula injection. The generated content is SHA-256 sealed, and an append-only `RightsReportAttestation` records the authority, period, user, row count and exact content hash before download is enabled.

Every export states that its evidence basis is device-confirmed completed music playback, audience measurement is false, and royalty calculation is false.

## Security and operational boundaries

- All reads derive the active organisation from the signed-in session.
- Only owners and managers may change authorities and work mappings.
- Track and authority ownership are rechecked inside the database transaction.
- Downloads require the requesting user, active organisation, ready export and matching attestation.
- Usage writes occur in the existing proof-of-play transaction and fail closed if evidence cannot be recorded.
- The free staging service remains outside the release path.

## Validation plan

- Unit tests cover authority, mapping and period validation, idempotent evidence hashes, aggregation, unmapped evidence and safe CSV generation.
- Static tests assert the append-only database triggers, route access boundaries and integration with verified proof ingestion.
- Existing Retail Radio, School Radio, Online Radio, proof, reporting and navigation regressions remain in the full suite.
- CI retains repository integrity, dependency audit, media toolchain, Prisma migration, full tests, production build and route-level acceptance.

## External dependency boundary

Ruvanas now provides the governed evidence and export foundation. Production submission still requires the relevant authority's current schema, credentials, onboarding, legal recognition and reconciliation rules. Stage 19.23 may expose those integrations through provider adapters without changing the immutable ledger.
