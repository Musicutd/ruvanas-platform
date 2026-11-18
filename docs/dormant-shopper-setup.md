# Preparing a disabled shopper

Super Admin can open **Organisations → Prepare disabled shopper** before a hosted Rewards rehearsal. Select the test workspace explicitly, then enter a shopper name and a new email distinct from the Client Admin. The form has no password field.

This creates a `DISABLED` `RewardShopper`, its `RewardShopperSetup` preparation record and an audit entry in one transaction. The workspace is recorded only as preparation provenance. It grants no business membership or access to that workspace's private information. The shopper remains a separate consumer identity.

No credential, invitation, shopper membership, session, pilot enrollment, programme, entitlement, coupon, subscription, charge, location, player or stream is created. No email is sent. The form does not change Rewards flags or public registration.

The new path uses the existing established Super Admin session boundary, including private-preview owner validation, fresh database authority checks and transaction locks. Client Admins, preview testers and bootstrap-code sessions cannot use it. The POST endpoint applies same-origin checks, strict bounded JSON, rate limits and safe response projection.

Case-insensitive existing business, shopper credential, invitation and preparation emails are refused. Concurrent preparation, ordinary Client Admin creation and pilot invitation requests use serializable transactions and reciprocal collision checks. An existing shopper is never silently adopted. Other legacy account-creation flows are outside this preparation path; public registration remains closed.

## Activation is separate

Prepared shoppers cannot sign in, claim or redeem. The existing pilot invite path refuses a reserved setup email. A future explicit, separately reviewed activation flow must verify the shopper ID and preparation provenance, recheck scoped Rewards policy and entitlements, and issue an invitation. It must never activate or adopt a record just because its email matches. This release intentionally contains no activation endpoint.

## Release and rollback

Apply the additive `RewardShopperSetup` migration before deploying the website change. It creates no records or permissions. Existing website binaries ignore this additional table; rolling the website back preserves prepared records but cannot manage them. Keep the additive table during rollback. No encoder deployment or configuration change is required.

An older website also lacks the new email-reservation checks. After rollback, pause new Client Admin and shopper provisioning until the forward version is restored. This is schema compatibility, not a claim that the older code preserves the new cross-store identity guards. Dormant shoppers still have no credentials or memberships and cannot sign in.

Verify the service and HTTP boundary tests, isolated PostgreSQL tests and the website build before publication. Use only synthetic accounts in local fixtures. Real shopper preparation is a separate hosted operation after publication; local tests do not create a real account.
