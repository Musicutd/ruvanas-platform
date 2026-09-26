# Ruvanas Inside — C3 programmes and Corrections Guard

## Local implementation

This stage adds facility-scoped programme drafts, immutable submission revisions, staff review, optional second facility review, changes requested, rejection and audit records. Staff assignments use `CorrectionsFacilityGrant`, a Corrections-only permission table. Owners assign facility managers, editors or viewers from their existing organisation team. These grants do not change shared Retail, School or Organisations branch permissions.

A submission records one approved Studio render, its output checksum and fingerprint, current organisation/facility policy versions and whether two reviewers are required. The submitter cannot review their own submission; the optional second reviewer must also differ from the first. Editing an approved programme returns it to draft. A change to either policy version or to the exact rendered audio invalidates readiness. Review and readiness checks re-evaluate the current entitlement and facility access. Audit logs cover programme creation/editing, submission, reviews and staff grants.

The subscriber has a dedicated **Programmes and staff review** page linked from Inside setup. It presents only programmes for facilities the member may see. A submitted audio version can be listened to through the existing private media stream. That stream now checks Inside entitlement and facility grant when the media is used by a Corrections submission.

The scheduling gate reports whether approval evidence is current, but **does not publish, schedule or start playback**. Existing schedule and AutoDJ publication paths explicitly reject Corrections facilities, secure areas and Corrections channels. Facilities and their first zones remain `DRAFT`/`OFFLINE`; no public station, player or listener route was added.

## Database and release boundary

`20261128000000_corrections_programmes_guard` adds programme, submission, review and facility grant records, plus policy version and dual-approval fields. It and the earlier C1/C2 migrations remain **local and unapplied**. This stage has not been committed, published or deployed. Do not point these routes at production until migrations and later private-delivery gates are ready.

Contributor identity and supervised Studio access belong to C4. Scheduling, secure player delivery, live monitoring and real-audio validation remain later stages. An approval in C3 is a governance decision, not a claim that the content is playable or that the station is live.

## Verification

- C3 permission, reviewer-separation, source-fingerprint, policy-change and scheduling-lock tests passed.
- Full unit/static tests: 927 total, 919 passed, 8 skipped, 0 failed.
- Static integrity and Prisma schema validation passed.
- Production build was checked with a placeholder database URL; this is not a live database or browser test.
