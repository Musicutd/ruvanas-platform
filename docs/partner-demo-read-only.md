# Read-only partner tour

The partner tour is deliberately **not** a Super Admin role. It uses a separate, random invitation code and a separate `ruvanas_partner_demo` cookie. Neither grants a normal Ruvanas account session, organisation membership, Super Admin APIs, complimentary-access controls, or subscriber data access.

## Super Admin workflow

1. Open `/admin/partner-demos` and preview the sample tour.
2. Enter the partner name and recipient email to create a one-use code.
3. Copy the code immediately; only its digest and final six characters are retained.
4. Send the code privately with `/partner-demo/access`.
5. Revoke the invitation at any time to invalidate both an unused code and an active session.

An unused code expires after 48 hours. A redeemed session expires after seven days. Redemption requires the matching email text, but does not prove control of that mailbox; the code is a bearer secret and must be delivered securely. No automated email is sent.

## Information boundary

The demo is built from the existing six-product guide content and clearly marked synthetic examples. Its Retail music chooser changes local browser state only. The distributor example does not call an API, expose files, disclose licensed catalogue content, or show real rights or usage reports. Normal admin and subscriber routes continue to require their existing authentication and permissions.

If partners later need to inspect actual customer, distributor, or licensed catalogue data, this demo must not be extended to expose it without a separate scope review, verified identity, stronger authentication, data-sharing permission, and route-level authorisation tests.
