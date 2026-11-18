# RR07b — local Super Admin pilot setup

Status: local candidate; no production activation or deployment is authorised by this milestone.

The Super Admin prepares selected test organisations without purchasing subscriptions or changing their existing plans. Client administrators continue to manage their own offers; shoppers remain a separate global identity with invitation-only membership. The pilot origin does not restrict a shopper to one shop.

## Authority and visibility

- Main Rewards and `RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED` must both be explicitly true. Missing/malformed flags fail closed.
- `RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS` is an explicit JSON array of 1–10 unique organisation IDs. There is no all-organisations fallback.
- Only current PASSWORD/SSO Super Admin sessions qualify. Support, merchants, shoppers and private preview tester sessions do not. Authority is checked again inside serializable mutations with exact user/session locks.
- Public registration stays closed. No email delivery, automatic live activation, streaming writes, paid plan changes or billing actions are part of the setup.

## Workflow

1. Select an existing allowlisted Retail organisation. Create an independent trial Rewards programme/grant with explicit capacities and expiry within 30 days. Existing grants are not overwritten.
2. Publish the chosen existing shop's explicit shopper-facing profile after confirmation. Private addresses and internal fields are not copied.
3. Approve an exact currently published coupon revision for discovery. Later revisions require separate approval. All coupon locations must belong to this organisation and have published opted-in shop profiles.
4. Invite a new shopper with membership no later than the pilot grant expiry. The one-use invitation expires within 24 hours. Its secret is displayed once, never logged, stored in browser storage, or put in a URL. There is no email sending.
5. Reissue or revoke only an unaccepted invitation created by this organisation's pilot. Existing accounts are never adopted by matching email. Accepted shopper accounts cannot be altered through these controls.

## Persistence and transport

Two additive models record immutable pilot shopper provenance and audit history. Restrictive foreign keys preserve existing history; organisation reset must roll back when this history exists. Existing shopper, membership, rights, subscription and audio semantics stay intact.

Every mutation writes an audit event atomically. Audit metadata excludes email addresses, tokens, passwords and raw request bodies. Read DTOs select only explicit bounded fields; tokens occur only in successful invite/reissue responses. APIs use same-origin JSON requests, rate limits and private no-store responses. Failed requests return sanitised errors.

## Acceptance

Use synthetic data and an owned loopback PostgreSQL instance to exercise additive migration constraints, exact tenant/role isolation, invitation acceptance/reissue/revocation, public shop consent, exact revision approval, normal shopper discovery/claim, audit rollback and disabled-feature denial. Build and run the real local website with production flags absent/false by default. No hosted systems are used.
