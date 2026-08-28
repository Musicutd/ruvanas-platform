# Stage 4B — School Radio editorial workflow

Stage 4B turns the existing School Radio entitlement and staff-announcement foundation into a private, supervised production workspace. It reuses the current organisation, membership, audio-version, audit, schedule, player, and proof-of-play boundaries; it does not create a second radio platform.

## Delivered workflow

1. An owner or manager creates a supervised student group. The acting staff member is linked through `StaffSupervisor` to their existing Ruvanas user account.
2. Staff add minimal `StudentContributor` records using only a school-approved display name and optional internal reference. Students receive no login and no direct messaging.
3. Staff create an active `SchoolProgramme`, optionally owned by a student group.
4. Content staff create an `SchoolEpisode` draft and credit active contributors.
5. Staff upload audio through the existing organisation media pipeline and submit a selected `PromoVersion` as a versioned `SchoolSubmission`.
6. A resubmission supersedes the previous current submission without deleting its history.
7. An owner or manager approves, requests changes, or rejects the current submission. Every decision creates an immutable `SchoolModerationReview` and an organisation audit event.
8. Staff can append consent status events. Expiry and revocation are enforced by the reusable publication policy functions.

## Safety boundaries

- Every editorial row is directly organisation-scoped, and every API resolves the active organisation before reading or writing.
- School Radio entitlement checks remain mandatory at page and API boundaries.
- Public episode publishing is disabled in this release. New episodes are always `INTERNAL_ONLY`.
- Public policy validation requires an enabled public-publishing capability, an approved episode, and current consent for every contributor.
- Episode approval also requires the submitted audio to have passed the existing promo/audio approval workflow.
- Consent records contain status, scope linkage, policy version, optional expiry, and a short evidence reference only. Consent document contents are not stored.

## Models

- `StaffSupervisor`
- `StudentGroup`
- `StudentContributor`
- `SchoolProgramme`
- `SchoolEpisode` and `SchoolEpisodeContributor`
- `SchoolSubmission`
- `SchoolModerationReview`
- `ConsentRecord`

## Operational checks

- `npx prisma validate`
- apply migrations to a temporary PostgreSQL database in CI
- unit tests for episode transitions, consent expiry/revocation, and private-by-default publication
- integration checks for unauthenticated editorial and moderation routes
- production build before publishing

## Intentionally deferred

- browser microphone recording and waveform editing;
- scheduling approved episodes into the existing shared compiler;
- guarded student accounts or invitations;
- public podcast/web publishing and public metadata;
- jurisdiction-specific retention automation.

Those capabilities remain separate controlled increments. The Stage 4B schema and policy helpers provide their safe extension points without exposing unfinished functionality.
