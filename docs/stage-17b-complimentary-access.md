# Stage 17B — Controlled Complimentary Access

## Purpose

Ruvanas can grant a named client free access to any active service tier without creating a trial, changing payment records, or setting an automatic expiry date. Access remains active until a Super Admin explicitly stops it.

## Operating flow

1. A Super Admin opens **Customers & business → Complimentary access**.
2. The tier catalogue shows the total number of active tiers and the limits and products included in each tier.
3. The Super Admin selects one client organisation and one tier, adds an optional internal note, and creates a code.
4. The plaintext code is displayed once. Only its SHA-256 hash and final four characters are stored.
5. An organisation owner or manager opens **Complimentary access** in the client dashboard and activates the code.
6. The selected tier becomes the organisation's effective service tier without charge.
7. The Super Admin can stop active access or cancel an unused code immediately.

## Commercial separation

- Complimentary access is not represented as `TRIAL`.
- The normal subscription, billing provider, payment status, and billing contract are preserved.
- While a complimentary grant is active, its tier snapshot takes precedence only for service entitlements.
- When the grant is stopped, the complimentary snapshot is cleared and the existing subscription state becomes effective again.
- Codes do not create invoices, renewals, or automatic conversion to paid service.

## Controls

- Code creation, cancellation, and revocation require `SUPER_ADMIN`.
- Codes are bound to one organisation and one tier.
- Codes are single-use and are claimed transactionally.
- Only organisation `OWNER` and `MANAGER` members can redeem a code.
- No automatic expiry exists; a Super Admin remains in control of the end date.
- Stopping an active grant revokes its current player-listener leases so copied or open player sessions cannot continue under the removed allowance.
- Every issue, activation, and revocation is written to the tenant audit log without storing the plaintext code.

## Tier snapshot

The activated snapshot includes station/stream limit, listener capacity, storage, bitrate, catalogue access, promotional uploads, School Radio, public School Radio publishing, Retail Media, and Digital Signage. This keeps the agreed complimentary offer stable even if the shared tier definition is edited later.

## Deployment

The database migration creates the code ledger and adds nullable complimentary entitlement fields to subscriptions. Existing clients are unaffected because `complimentaryAccessActive` defaults to `false`.
