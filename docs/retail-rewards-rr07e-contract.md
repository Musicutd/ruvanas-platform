# RR07e — Private-preview pilot sign-in compatibility

Local, unpublished candidate. No hosted accounts, flags, registration, subscriptions, streaming configuration or encoders are changed. Existing migrations and dependencies are unchanged.

## Explicit access boundary

`RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED` is a strict, default-off flag. It requires valid private-preview configuration, the existing Rewards and pilot-admin flags, and the exact pilot organisation allowlist. It cannot turn Rewards on by itself. Missing, false or malformed configuration admits no pilot access through private preview.

The ordinary `/login`, `/api/auth/login`, preview owner/tester login and global session lookup retain their previous behaviour. Public registration, business team invitations, recovery, paid actions and non-Rewards routes remain closed to pilot sessions. Existing preview accounts are not converted, promoted or granted extra privileges.

## Separate journeys

- Existing ordinary Super Admin, Client Admin and cashier accounts use `/rewards/pilot-sign-in`. This endpoint verifies their current business password; it creates no user, membership, plan or grant. A business must have a current membership in exactly one permitted organisation or supply its explicit permitted workspace ID. Support, student, foreign and preview accounts are rejected. SSO-only tenants cannot use password fallback through this endpoint.
- Business sessions use the existing signed-token-hash database and cookie format with a one-hour maximum pilot session. Shared session checks still enforce revocation, absolute age, idle expiry and SSO requirements. Only explicitly opted-in Rewards adapters may retrieve ordinary pilot sessions during private preview; generic application authentication cannot.
- Super Admin can reach only the existing exact-allowlisted pilot setup operations. Client staff reach only reviewed Rewards pages and APIs. Existing tenant, role, shop, capability, entitlement and quota checks continue to authorise each action. The pilot shell contains Rewards links and sign-out only.
- Shoppers retain their separate invitation, password, cookie and membership model. Preview-pilot invitation acceptance, sign-in and every authenticated read require a pilot-origin enrollment in a currently allowlisted organisation. Discovery, claim retries, wallets and checkout credentials exclude merchants outside the pilot allowlist. Normal preview-off discovery behaviour remains unchanged.

The middleware enumerates reviewed path/method combinations rather than exempting `/admin`, `/dashboard` or an API prefix. Framework static scripts are admitted only while the explicit bridge is enabled. POSTs to HTML pages and server-action requests receive no pilot admission. No request-supplied role, session, tenant header or redirect grants access. Existing origin, request-size and handler throttles remain in force. The dedicated business sign-in adds bounded strict JSON, independent IP/account throttles, generic errors and fixed destination literals. Passwords and tokens are not logged or placed in URLs.

## Readiness and proof

The readiness report marks authentication configuration compatible only when the explicit bridge is valid and the selected organisation is allowlisted. `endToEndTest` remains `NOT_VERIFIED`; configuration never substitutes for a real shopper claim and shop redemption.

The local harness runs a production build against a disposable loopback PostgreSQL database using synthetic accounts. It covers disabled and blocked configurations, actual business and shopper password verification, invitation acceptance, tenant isolation, claim/redemption, revocation and registration denial. Synthetic React/browser tests verify the sign-in interface separately; they do not claim to sign in real hosted users or to verify mailbox ownership. The harness enables test flags only in its isolated child process and stops its database/server afterwards.

Before a hosted pilot, separately review ordinary business account provisioning and credentials, explicit flags/allowlist, intended shopper invitations and any hosting budget. No such activation or credential creation is included here.
