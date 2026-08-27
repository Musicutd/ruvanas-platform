# Phase 3A: versioned promotional assets

This milestone separates the business identity of a promotion from the binary audio stored in `MediaAsset`. Campaigns can now target an immutable, approved `PromoVersion` rather than a replaceable file.

## Domain model

- `PromoAsset` owns the stable organisation, display name, audio type, default language, lifecycle state, and current approved version pointer.
- `PromoVersion` records a monotonically increasing version number, source, language, checksum, duration, QC status, review decision, reviewer, and timestamps.
- `PromoProcessingJob` records queued preview, transcode, and loudness-analysis work independently so later workers can retry safely without changing the version identity.
- Existing organisation promo files are backfilled as version 1. Ready legacy files become approved without moving or renaming their R2 objects.

## Workflow

1. An upload creates a new logical promo or a new version of an existing promo.
2. Audio signatures, subscription entitlement, storage quota, organisation ownership, and protected storage are checked using the existing upload boundary.
3. The version enters `IN_REVIEW` with pending QC and three idempotently named processing jobs.
4. An owner, manager, or platform super administrator can approve or reject the exact version.
5. Approval supersedes the previous approved version and atomically changes the promo's current approved version pointer.
6. Archiving hides the logical promo while retaining every version, review, and audit record.

## Compatibility and safety

- The protected `/api/media/:mediaAssetId/stream` route remains unchanged, so existing previews continue to work.
- A media binary referenced by promo history cannot be hard-deleted through the old endpoint.
- Duplicate binary uploads may reuse the same `MediaAsset`, but every business submission receives its own immutable `PromoVersion`.
- Rejected versions require review notes. Versions with failed processing jobs cannot be approved.
- Review and archive mutations are organisation-scoped and audited.

## Next milestone

Phase 3B will add campaign drafts and targets, date/day/time windows, plays-per-hour and interval rules, safety guardrails, deterministic preview, conflict warnings, and publication against the current approved promo version.
