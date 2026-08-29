# Stage 10A — School Publishing Operations

Stage 10A adds a privacy-safe operational view for controlled public School Radio releases. It helps school owners and managers confirm that published metadata and audio are being offered without creating student, listener, device, or audience profiles.

## Delivered foundation

- Daily aggregate evidence for public episode metadata listings.
- Daily aggregate evidence for full and range audio delivery requests and bytes offered.
- A manager-only 30-day operational view with a maximum 93-day query window.
- A manager-only CSV export with a recorded audit event and content checksum.
- Current public-episode and publishing/unpublishing decision summaries.
- A read-only retention preview based on the school safeguarding pack.
- Public delivery remains available if evidence recording is temporarily unavailable.

## Privacy and evidence boundary

The aggregate table stores only the organisation, public episode, UTC day, and operational counters. It does not store IP addresses, cookies, browser identifiers, student identities, contributor identities, or listening history.

Metadata listings are origin responses, not page views. Audio requests and bytes offered are delivery requests, not proof that a person listened, completed an episode, or belonged to an audience. Browser range requests may create more than one request for a single playback attempt. All UI and CSV language preserves this distinction.

## Retention boundary

The manager view calculates cutoff dates from the approved safeguarding readiness settings:

- raw recording retention days;
- consent evidence retention days.

This stage is preview-only. It does not delete, archive, modify, or anonymise any file, consent record, or school record. A later retention executor must require a separately reviewed policy, legal basis, dry-run evidence, explicit manager approval, and an auditable rollback or hold process.

## Routes

- `GET /api/school-radio/publication-operations`
- `GET /api/school-radio/publication-operations/export`

Both routes require an active School Radio entitlement and an organisation owner or manager role. Tenant scope comes only from the authenticated organisation context.

## Database migration

`20260920000000_stage_10a_school_publication_operations` creates `SchoolPublicationDailyAggregate` with one row per organisation, public podcast episode, and UTC day.

## Verification

Before release:

1. Validate and generate the Prisma client.
2. Run the unit suite, including report-window, CSV, privacy-language, and non-destructive retention tests.
3. Run route-security integration tests when an isolated test database is available.
4. Run a production build.
5. Apply the migration before serving the new application version.

## Rollback

The operational UI and evidence-recording calls can be removed without changing the controlled publishing decisions. If the migration must be reversed, export any required aggregate evidence first, then remove the aggregate table only after confirming that no operational reporting period depends on it. Publishing, safeguarding, consent, and emergency withdrawal controls remain independent.
