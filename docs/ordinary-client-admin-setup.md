# Creating a Retail workspace with a Client Admin

This administrative flow creates a new ordinary business owner without opening public registration.

Open **Administration → Organisations → Add organisation → Create workspace with Client Admin**. Choose an active public Retail plan, enter the new workspace and Client Admin details, set an initial password privately, and confirm creation. Use a separate email for a Rewards shopper.

The form creates one ordinary `User` with role `OWNER`, one organisation, one `OWNER` membership, one `TRIAL` subscription and an audit record. It refuses existing business or shopper email addresses, including case variants; it never converts an account or adds a member to an existing workspace. It sends no email and creates no signed-in session, billing contract, Rewards programme, grant, shopper, location or stream.

The selected Retail plan controls the new workspace's ordinary capabilities. An unpaid trial record is not a purchase and does not promise automatic expiry: existing TRIAL semantics do not enforce `currentPeriodEnd`. Rewards access and its enforced expiry require a separate pilot grant.

## Access and security

- With private preview enabled, only the existing configured Super Admin with an established `PREVIEW_PASSWORD` session and valid owner grant can use this setup flow. Bootstrap codes and tester sessions are refused.
- Outside private preview, the caller must have a current ordinary `PASSWORD` or `SSO` Super Admin session, without a preview grant.
- The service reloads and locks administrator/session authority and the chosen plan inside the transaction; account, tenant, membership, subscription and audit creation either commit together or roll back together.
- The endpoint accepts same-origin POST JSON only, at most 8 KiB, with IP and administrator rate limits.
- Passwords require at least 15 Unicode characters and at most 72 UTF-8 bytes and are stored with bcrypt cost 12. Response and audit fields never include a password or hash.
- Private-preview login restrictions remain unchanged. Creating this ordinary account does not let it enter the existing preview tester routes.

## Rewards rehearsal prerequisite

This flow only resolves merchant account creation. During an independently approved rehearsal, the configured private-preview Super Admin can reuse their established password session for the pilot administration page. The main Rewards flag, pilot-admin flag, preview bridge and exact organisation allowlist must all permit that access. Sign in through the normal administration login, then open the gated Rewards pilot link; the business pilot password form remains for ordinary business accounts.

Preview testers and bootstrap codes cannot use this administrator path. It grants no merchant or shopper identity, and does not turn Rewards on. Ordinary merchant pilot login and shopper invitations remain unavailable until their existing scoped policies are separately enabled. See [preview-admin compatibility](retail-rewards-preview-admin-compatibility.md).

Deploying this code does not create any account automatically. Hosted provisioning, credential entry and Rewards activation are separate actions.

## Local checks

Run `node --test tests/ordinary-owner-provisioning.test.mjs tests/ordinary-owner-http.test.mjs`, then the existing private-preview, registration, tenant and pilot regression tests. Exercise a real isolated PostgreSQL transaction before release. Use synthetic identities and never load a production connection into the local test.
