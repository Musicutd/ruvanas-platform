# Phase 3E — School Radio staff announcements

## Outcome

Ruvanas now has an additive School Radio foundation that reuses the existing tenant, audio review, location, player, scheduler, audit, and proof-of-play systems. It does not create a separate platform or duplicate the retail-radio core.

## Safety boundary

- Staff accounts only; no student accounts or student identity fields.
- School publishing policy defaults to `PRIVATE`.
- The capability is disabled by default with `Plan.schoolRadioEnabled`.
- Every API resolves the signed-in user's active organisation and rejects cross-tenant resources.
- Announcement audio must already be organisation-owned, ready, and approved through the existing immutable promo-audio review process.
- Content staff can create and submit announcements. Only organisation owners/managers can approve, reject, request changes, schedule, or cancel.
- Review and scheduling actions produce tenant-scoped audit records.

## Workflow

1. Ruvanas operations uploads and approves organisation audio through the existing Promo Library.
2. School content staff select approved audio, add staff-facing context, and submit an announcement.
3. An owner or manager reviews the announcement.
4. An approved announcement can be assigned to one location or one zone with a bounded start/end time.
5. The shared insertion scheduler gives an approved School Radio slot precedence over a campaign insertion within the same one-minute window.
6. Enrolled players receive signed `SCHOOL_ANNOUNCEMENT` manifest items from the same protected media endpoint.
7. Playback events retain the school broadcast slot ID in immutable proof-of-play evidence.

## Data model

- `SchoolProfile`: one per organisation, private by default, with a versioned policy marker.
- `SchoolAnnouncement`: staff-created metadata connected to an approved `PromoVersion`, with explicit review states.
- `SchoolBroadcastSlot`: manager-approved location/zone targeting and bounded timing.
- `PlayoutIntent` and `ProofOfPlayEvent`: extended additively for school-slot attribution while preserving campaign reporting.

Database constraints enforce exactly one slot target, a positive slot duration, one playout source, and the correct evidence shape for music, campaigns, and school announcements.

## Rollout

1. Deploy the migration and application to staging.
2. Enable `schoolRadioEnabled` only on the chosen staging plan.
3. Verify staff creation, manager review, scheduling, player manifest, protected playback, cancellation, tenant isolation, and audit logs.
4. Keep the production capability disabled until the staging acceptance checks pass.
5. Enable the chosen production plan deliberately; no other plan or Render project is changed.

## Deferred intentionally

Student accounts, student profile data, public publishing, remote recording, moderation automation, consent records, and community sharing remain outside this milestone. They require a separate safeguarding and privacy review before implementation.
