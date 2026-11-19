# Expired private pilot access renewal

Local change based on voucher-wallet release `6c3c4fe`, prepared 19 November 2026. This work does not enable Rewards, open registration, deploy the website, create accounts or operate either encoder.

## Problem and intended behaviour

A rehearsal can expire before its prepared shopper accepts an invitation. First-time preparation correctly refuses to recreate the programme or grant; invitation reissue correctly refuses expired entitlement and membership. A Super Admin needs a separate, reviewed way to extend the existing internal test access.

The new flow reviews the exact existing trial grant, prepared shopper, membership and revoked invitation. A confirmed renewal extends only the permitted expiry and membership revision, with a maximum two-hour window. It preserves account and access-record identities, subscription and limits, historical usage, receipts and audit records. It creates no password or shopper session and keeps the shopper disabled. Invitation reissue and the shopper's own acceptance remain separate steps.

## Access boundary

Both read-only review and renewal require the existing Rewards/private-pilot configuration, an allowed organisation and current Super Admin authority. They confer no merchant or shopper bypass. With Rewards disabled, the operations fail closed before database access.

Only an expired, unrevoked internal trial grant and matching expired internal membership are eligible. The shopper must be the same prepared disabled identity, with matching immutable setup/enrollment provenance and a revoked, unaccepted invitation. Unexpected credentials, sessions, foreign records or identity collisions are refused. Active or suspended shoppers and normal paid access are outside this narrow recovery path.

Review returns an opaque fingerprint of the saved state. Renewal pins that fingerprint, a fixed requested expiry and a request ID. A transaction rechecks authority and saved state, updates existing rows atomically and appends safe audit evidence. A matching retry returns the same outcome without extending time or duplicating audit history; stale or changed requests fail rather than silently applying new authority.

## Administrator workflow after a separately approved release

1. During an explicitly approved private rehearsal window, select the existing allowed test workspace and prepared shopper.
2. Review the saved expiry and unchanged allowances. Choose the new expiry in Malta time, no more than two hours ahead.
3. Confirm renewal of these existing records. A successful result does not send an invitation or activate the shopper.
4. Use the separate invitation reissue action. The shopper enters and submits their own new password on the acceptance page; the Client Admin signs in separately.
5. Complete only the approved simulated tests, reconcile receipts and close access by the agreed deadline.

Do not recreate a shopper or location, reuse an old invitation, change paid plans or update production database rows manually. Existing features and controls remain off until a separate hosted rehearsal is authorised.

## Validation and release status

Implementation and local test outcomes are recorded in `output/retail-rewards-pilot-renewal-20261119/report.md` in the workspace. Synthetic positive tests use an isolated local database and fixture flags; they are not evidence of hosted account activation or real shopper acceptance.

Local validation on 19 November passed: 704 Node 20 regression tests across 74 files, 14 isolated PostgreSQL 16 checks, Prisma schema validation, the production website build and nine compiled localhost route checks. The route checks verified disabled Rewards pages, blocked renewal endpoints in private preview, and closed registration. Owned test servers were stopped afterward. Existing CSS compatibility warnings remain in unchanged stylesheets; they did not prevent the build.

The GitHub workflow includes a dedicated Node 20/PostgreSQL 16 job for this regression. Adding the job locally does not run GitHub CI or publish code. Publication, any production migration and deployment require a later request.

## Migration and rollback

The additive migration adds `PILOT_ACCESS_RENEWED`, a strict audit metadata validator and request uniqueness. It updates no existing access expiry, identity, credential, limit, programme, feature flag or historical receipt. The function pins its search path for logical restore compatibility. Existing audit immutability triggers remain in place.

Before any separately authorised hosted migration, check for duplicate non-null `(organisationId, action, requestId)` values in `RewardPilotAuditEvent`. Existing service writes use null request IDs, but historically inserted non-null duplicates would cause the unique index to fail safely. Resolve any finding through a reviewed migration change; do not delete or rewrite audit history. This local implementation has not inspected production audit rows.

For application rollback, retain the additive schema and audit evidence and leave Rewards disabled. An older release's strict audit response validation does not recognise the new action. Do not drop enum values, erase renewal events or reverse renewed expiries with ad hoc database changes. Any future hosted rehearsal must close access through its approved shutdown procedure, independently of application rollback.
