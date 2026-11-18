# RR07d — pilot readiness and next steps

Status: local, unpublished candidate. This is a read-only setup assessment, not an activation or release approval. Rewards stays disabled in production, public registration closed and both encoders untouched.

## What the Super Admin sees

The existing allowlisted Rewards pilot page now has a readiness checklist. It checks the authentication environment, ordinary Client Admin account, current Retail and Rewards access, published shops, approved current coupon revisions, checkout authority at a matching shop, and accepted eligible pilot shoppers. Pending invitations are shown separately from accepted shoppers.

The report separates three questions:

- Is the required setup recorded?
- Is that setup eligible at the reported check time?
- Has a complete shopper-to-cashier test been verified? This report always answers **not verified**. Stored setup is never proof of sign-in, a completed redemption, a physical scanner test or a successful launch.

Refresh retrieves a new assessment without creating accounts, extending access, changing plans, approving terms, sending invitations or changing playback. Next-step links stay within existing Super Admin setup sections. Instructions for a Client Admin, cashier or shopper identify the role that must use its own account; they do not impersonate that role.

## Authentication environment limitation

The existing private-preview host admits preview sessions. Rewards business operations require ordinary PASSWORD/SSO sessions and reject private-preview accounts; Rewards shoppers use a separate consumer session. Consequently, enabling Rewards flags alone cannot make existing private-preview testers usable as Rewards participants. The public-site setting can also force private-preview mode, and invalid preview configuration fails closed.

The checklist exposes this incompatibility. It does not turn preview off, change login routing, bypass registration policy or convert tester accounts. A separately reviewed invitation-only pilot access setup is needed before using that host for normal Rewards roles. Previous local acceptance ran with private-preview mode off and does not establish hosted compatibility.

## Access and data boundaries

Readiness uses the existing main Rewards and pilot-admin feature gates, exact organisation allowlist, current ordinary Super Admin session and server-side tenant checks. Support, shoppers, Client Admins and private-preview sessions cannot read it. Responses contain bounded counts and fixed status codes, not member emails, passwords, invitation tokens, private addresses or another client's data. Expired/revoked access and mismatched coupon revisions must never be reported as eligible.

Admin navigation shows Rewards pilot only after the existing pilot authorizer succeeds. The navigation item itself grants no authority and the API rechecks each request. Flags off or failed authorisation leave the existing navigation unchanged.

This milestone adds no database model, migration, dependency, payment integration, hosted service, registration exemption or audio change. Invitation delivery, accepted-shopper recovery, grant renewal, production release review and pilot activation remain separate work.

## Verification

Use synthetic local unit tests, the production build, an owned disposable loopback database and browser fixtures. Include tenant/role denials, expiry and revocation, missing or inactive shops, obsolete approvals, checkout scope, pending versus accepted shoppers, preview incompatibility, stale/cross-organisation responses and no-write evidence. All release gates described in RR07c still apply; local readiness is not a hosted pilot approval.
