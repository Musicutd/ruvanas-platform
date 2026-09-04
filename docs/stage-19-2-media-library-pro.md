# Stage 19.2 — Media Library Pro and rights metadata foundation

## Outcome

Stage 19.2 extends the existing protected `MediaAsset` and `Track` foundation so an organisation can hold its own music alongside promotional audio and the shared Ruvanas catalogue. It does not create a second upload, storage, delivery or playout system.

Organisation music follows a controlled journey:

1. an authorised organisation owner, manager or content editor uploads a protected audio file;
2. the uploader records the track metadata, rights holder, agreement reference, rights basis, territories, usage categories and optional licence window;
3. the recording remains a private draft and cannot enter programming;
4. the organisation previews the exact stored recording and submits its declaration;
5. a Ruvanas Super Admin reviews the declaration and either approves it or requests changes with a reason;
6. only a ready media file with ready track metadata and an approved, current rights record can pass the shared eligibility service.

## Shared architecture

- `MediaAsset` remains the single protected binary and storage identity.
- `Track` remains the music metadata and rights record.
- `MediaLibraryType.ORGANISATION_MUSIC` distinguishes subscriber-owned music from Ruvanas catalogue music and organisation promotional audio.
- `lib/media-library-pro.mjs` is the central rights-window, tenant, territory, usage and review eligibility policy.
- Music Mode creation and live playback use the same eligibility decision.
- Existing Ruvanas catalogue rows are migrated to the explicit approved state so Stage 19.1 behaviour is preserved.

## Rights metadata

The foundation records:

- rights basis: owned master, direct licence, distributor licence or other documented permission;
- rights holder and agreement/reference;
- permitted territories;
- permitted services: In-house/Retail Radio, School Radio and Online Radio;
- optional licence start and expiry dates;
- the declaring user and time;
- Ruvanas review status, reviewer, time and notes.

These records are operational evidence, not legal advice and not a licence. Ruvanas approval confirms that the platform review was completed; it does not create rights that the organisation does not hold.

## Product-context safety

The current shared Retail/School/Online playout path does not yet identify every channel with a single product type. To prevent a recording cleared for one use from leaking into another, organisation music can enter that generic path only when all three service uses are permitted. A product-aware caller may request one explicit use. Later Stage 19 scheduling/resolver work can pass that context without changing the rights model.

## Security and tenant controls

- The active organisation comes from the signed-in session; the upload API does not trust a submitted organisation ID.
- Storage keys are checksum-addressed below the organisation boundary.
- Duplicate files, invalid signatures, inactive services and storage-limit breaches fail closed.
- Subscriber list and submit operations query through the active organisation.
- Only a Super Admin can make the Ruvanas rights-review decision.
- Every upload, submission, approval and rejection creates an audit record.
- Protected previews continue through the existing authenticated media streaming route.

## Deliberate limits

- Stage 19.2 does not obtain music licences or certify legal authority.
- It does not implement royalty calculations or authority-specific reports; those remain Stage 19.22.
- It does not add fingerprint matching, acoustic deduplication, bulk metadata editing or cue-point analysis.
- It does not publish a rejected, expired, future-dated, cross-tenant or partially permitted track through the shared resolver.

## Rollback

The change is additive. Existing catalogue and promotional media continue to use their current library types. Application rollback leaves the new organisation music records dormant. Database rollback should be performed only after preserving or removing Stage 19.2 records because PostgreSQL enum values and new rights metadata may be referenced by live data.
