# RR07c — local Client Admin staff setup

Status: local candidate only. Rewards remains disabled in production. This milestone does not authorise publication, activation, invitations, charges or changes to either audio encoder.

## Shop-owner workflow

An existing Client Admin with the current organisation's OWNER role can open Rewards → Manage staff access. They choose an existing eligible team member, specific active shops, permitted actions and an expiry no later than the current Rewards grant. The cashier preset grants coupon redemption only; reading or editing the offer catalogue is not a prerequisite for checkout.

Saving replaces that member's current Rewards scope. Removed shops are revoked, not silently retained. Revoke removes current Rewards grants without deleting historical redemptions or audits. Neither operation changes the member's organisation role, password or login. A stale edit requires a fresh review before saving again.

Each existing member with an unrevoked, unexpired grant reserves one staff seat, even with grants for several shops. Future-dated grants also reserve a seat. A role or account change does not free that reservation: restoring a role must not resurrect extra access beyond the allowance. Only expiry or revocation releases it. Concurrent allocations must not overrun the explicit seat limit.

## Security and persistence

- Main Rewards and `RUVANAS_RETAIL_REWARDS_STAFF_ADMIN_ENABLED` must be explicitly true. Both are off by default.
- MANAGE_STAFF is restricted to the current tenant's OWNER. Support, shopper, private-preview and unscoped platform access cannot substitute for this authority.
- Target members must already belong to the same organisation and use an eligible ordinary business account. This page creates no users, memberships, roles, invitations or paid plans.
- Only explicit active shop selections are written. Capabilities cannot exceed the target member's current role ceiling; MANAGE_STAFF cannot be delegated here.
- Authority, expiry, membership, locations and allowance are rechecked inside the transaction. The programme lock serializes mutations with existing checkout and offer services. A rejected audit write rolls back the staff change.
- Existing `RewardStaffGrant` and immutable `RewardAuditEvent` models are reused. No migration or new dependency is required.
- Same-origin bounded JSON, no-store responses, current authentication, rate limits and selected DTO fields apply. Member email addresses and authentication secrets are not returned.

## Cashier navigation

Retail home and the Rewards landing page check checkout access independently from offer READ access. A REDEEM-only cashier can reach the existing checkout page and see their permitted shops without receiving offer-management privileges. All checkout APIs retain their existing server-side authorisation.

## Pilot prerequisites and remaining release gates

1. A normal business login, current organisation membership and active Retail entitlement already exist. Private-preview tester accounts remain intentionally ineligible; enabling a pilot grant does not convert one into a normal business account.
2. Existing active shops are configured through the platform's organisation/location setup. RR07b can prepare an independent expiring Rewards grant for an explicitly allowlisted organisation.
3. The Client Admin publishes their coupon terms. The Super Admin separately approves explicit public shop fields and the exact coupon revision for discovery.
4. A new invited shopper accepts a one-use invitation. The Client Admin assigns an existing cashier through this milestone. The shopper can then claim and the cashier can validate/redeem at an assigned shop.
5. Browser and isolated database evidence must cover that ordinary path, tenant/role isolation, seat races, expiry, stale edits, revocation and immutable history. Local synthetic evidence is not a hosted pilot or a physical-camera test.

Before release: review the full cumulative candidate and additive migration history against production, run the required CI database version, review backup/rollback and legal/commercial readiness, then obtain explicit release and activation authority. Publishing code and enabling a pilot remain separate decisions. Renewal, accepted-shopper account recovery, public signup, payments and automatic POS discounts remain outside this candidate.
