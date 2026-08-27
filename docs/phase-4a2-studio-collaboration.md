# Stage 4A2 — Studio collaboration and private assets

This increment extends the tenant-scoped production-order intake delivered in Stage 4A1. It preserves the existing order workflow and adds the production workspace needed to collaborate safely on a retail audio order.

## Delivered

- Ruvanas production staff assignment, limited to `SUPER_ADMIN` and `SUPPORT` users.
- Immutable, sequential script versions with language and production notes.
- Explicit revision-request records created from customer change requests and resolved on the next approval submission.
- Private brief attachments (PDF, TXT, PNG, JPG; maximum 10 MB).
- Private audio previews and final masters (MP3, WAV, OGG, M4A; maximum 50 MB).
- File-signature and MIME checks before storage.
- Quarantine-first Cloudflare R2 writes and checksum evidence.
- Same-origin, authenticated file delivery without exposing R2 keys or URLs.
- A delivery guard that requires at least one final master.
- Append-only workflow events and audit records for assignment, scripts, files, and revisions.

## Access boundary

Every Studio query is scoped to the active organisation on the server. A user from another organisation receives a not-found response and cannot infer whether an order or file exists. Customers can add brief attachments; only Ruvanas production staff can create scripts, upload previews/final masters, or assign staff.

## Deferred to the next Studio increment

- Production-credit reservation and ledger settlement.
- Paid add-on checkout hooks.
- Linking an approved final master to a versioned promotional asset and campaign.
- Automated audio QC measurements and waveform generation.

