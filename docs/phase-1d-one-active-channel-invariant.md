# Stage 1D: one active channel per zone invariant

## Purpose

This milestone completes the master specification's strong transactional invariant: a zone can never have more than one active channel assignment, even when requests arrive concurrently or data is written outside the normal application workflow.

## Database enforcement

- The migration first ranks every active assignment per zone by effective and creation timestamps.
- If legacy duplicates exist, the newest remains active and every older duplicate is closed with the migration timestamp.
- A PostgreSQL partial unique index then permits only one `ChannelAssignment` with `activeTo IS NULL` for each zone.
- Historical closed assignments remain unchanged and continue to support audit and reuse workflows.

## Application hardening

- Single-zone and location-group assignment writes now use serializable transactions.
- Serialization (`P2034`) and uniqueness (`P2002`) races are retried up to three times.
- A conflict that remains after retries returns HTTP 409 with a safe operator message.
- Single-zone assignment rejects archived and cross-organisation channels in one tenant-bound query.
- Duplicate legacy assignments discovered before migration are closed and represented in audit details.

## Verification and rollback

- Unit tests cover serialization retry, uniqueness retry, and unrelated-error propagation.
- PostgreSQL integration coverage attempts a second active assignment and requires the database to reject it.
- Rolling back the application does not require removing the index because all existing assignment paths are compatible with the invariant.
