# Stage 4A3 — Production credits and promo handoff

This increment completes the provider-neutral accounting and delivery-linkage portion of the retail ProductionOrder milestone. It preserves the Stage 4A1/4A2 workflow and does not introduce plan prices, payment capture, or invented credit allowances.

## Append-only production-credit ledger

- Every organisation has a derived available and reserved balance; there is no mutable `creditsRemaining` field.
- Entries are sequential per organisation and retain grant, purchase, reserve, consume, release, expiry, and manual-adjustment movements.
- Each entry records both available/reserved deltas and the resulting balances, plus actor, order, reference, note, and optional expiry metadata.
- PostgreSQL transaction-scoped advisory locking serialises each organisation ledger, while an idempotency key prevents duplicate retried entries.
- Database constraints prevent negative available/reserved balances and invalid zero-quantity entries.
- Existing production orders are explicitly migrated as `LEGACY_UNMETERED`, so deployment cannot strand work already in progress.

## Funding lifecycle

- A submitted plan-funded order reserves one available credit. If none is available, submission is rejected without creating the order.
- A paid add-on remains pending until a `SUPER_ADMIN` records an external authorisation/reference. The provider-neutral hook records a purchase and immediate reservation but does not charge a customer.
- Production can start only when funding is reserved (or the order is grandfathered).
- Delivery consumes the reservation. Cancellation releases it.
- Super Admin ledger controls support audited grants, expiries, and signed manual adjustments. Commercial plan allowances and currency prices remain configuration work after they are formally approved.

## Studio final-master handoff

- A delivered order with a final master can create a versioned promotional asset without downloading or re-uploading the audio.
- The handoff reuses the private R2 object through a new organisation-owned `MediaAsset`, records `sourceType=STUDIO`, preserves the checksum, and queues the existing preview/transcode/loudness jobs.
- The new promo version enters `IN_REVIEW` with pending QC. It must pass the existing promotional review before scheduling.
- Once approved, Studio links directly to Campaign Builder with the organisation, promo version, name, and known campaign dates prefilled.
- Uploading a replacement final master can create the next immutable promo version; idempotent repeated handoff of the same master returns the existing version.

## Security and audit boundaries

- All ledger, funding, order, file, and handoff operations are scoped to the active organisation.
- Only a platform `SUPER_ADMIN` can grant/expire/adjust credits or authorise a paid add-on.
- Only Ruvanas production staff can create a Studio-to-promo handoff.
- Every ledger entry, funding transition, and handoff creates an audit record; storage keys remain server-only.

## Deferred

- Numeric monthly plan allowances and add-on prices, pending commercial approval.
- Payment-provider checkout, webhook reconciliation, refunds, and invoices (Stage 5 billing integration).
- A worker that completes queued ffprobe/ffmpeg measurements and waveform generation. The handoff queues existing QC jobs but does not claim that analysis has run.


