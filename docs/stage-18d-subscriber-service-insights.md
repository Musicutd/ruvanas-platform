# Stage 18D — Subscriber Service Insights

## Purpose

Stage 18D turns the subscriber operational report into a clear customer-facing service workspace. It helps an organisation understand whether its radio service is healthy, where playback is occurring, and what needs attention without presenting internal platform terminology.

## Subscriber experience

- A single **Service insights** page with 7, 14, 30 and 90-day shortcuts plus a bounded custom period.
- Summary cards for confirmed playback, completion rate, online players, playback exceptions and protected-audio storage.
- An accessible daily chart that compares confirmed playback with failed or interrupted items.
- A content mix for music, promotions and safeguarded school announcements.
- Direct operational actions for offline players, playback exceptions and reduced completion rates.
- Ranked location, player and station views with responsive tabs.
- Aggregate-only School Radio activity that excludes student identity, ranking and individual performance.
- A protected downloadable CSV with daily evidence and location, player and station performance sections.

## Evidence and privacy boundaries

- Every database read is scoped by `organisationId`.
- Playback values remain device-confirmed operational evidence, not listeners, reach, impressions or audience estimates.
- Station results are resolved only through channels belonging to the signed-in organisation.
- School metrics remain aggregate-only and do not expose student identities.
- Export creation, status and download continue to use the existing authenticated, tenant-scoped and expiring workflow.

## Operational constraints

- Reporting periods remain bounded by the existing 93-day maximum.
- Existing billing, stream quotas, player enrolment, roles and permissions are unchanged.
- No database migration or new environment variable is required.
- The free staging service remains outside this stage and must stay suspended.
