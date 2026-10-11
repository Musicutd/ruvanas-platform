# Private Ruvanas app preview

The public website at https://www.ruvanas.com/ must retain Coming Soon with a Log in button pointing to a separately approved private preview. The preview uses personal codes issued only by the designated owner. It has no username/password form or self-registration. Promo Only credentials are unrelated to preview access.

The code-only version is implemented and validated locally, not published or deployed. No real account, supplier credential, public domain or hosting configuration changed. Existing C8/C9 work remains separate and preserved.

## Code sign in and owner controls

Each code is random, single-use and valid for 24 hours. It identifies an existing individually approved Ruvanas user. Redemption cannot create an account, organisation or subscription, change a password or grant a role. Only a keyed, purpose-separated digest is stored. Successful transactional redemption creates a normal database-backed session marked PREVIEW_CODE and sets the HTTP-only cookie after commit. The session has the existing 30-day maximum, subject to enterprise idle, absolute-age and sign-in policy controls. After logout the user needs a new code.

The designated owner opens /admin/private-preview to issue a code for an existing approved account or revoke that account's pending codes and active code-based sessions. Issuing another code invalidates the previous unused code. The fresh code is shown once in the owner-only interface and must be sent privately; no automatic email is sent. Other administrators cannot issue or revoke preview codes. Revocation remains possible after an email is removed from the allowlist.

Every app page, API and asset requires a valid PREVIEW_CODE session and an approved email. Existing roles and organisation permissions still apply. A password or SSO session cannot independently bypass this preview gate. SSO-only organisations that prohibit fallback cannot use a code as a substitute for SSO.

Only the no-JavaScript code form, code-redemption/logout endpoints and minimal health endpoint are available before sign-in. Anonymous preview-root requests return to the public cover; direct app links go to preview sign-in, APIs return 401 and assets return 404. Registration, free-access registration and account-creating student/team invitation paths stay blocked even for signed-in testers. These restrictions apply only while private-preview mode is enabled; normal app behavior is preserved when disabled.

Redemption is size-bounded and database-rate-limited. Redemption and owner-control endpoints require the configured preview Origin. Error redirects use fixed reasons, never codes, emails or session tokens. Pending codes cannot authorize app requests. Preview responses use no-store/noindex controls; malformed configuration or failed session lookup denies access.

## Isolated server configuration

Set these values only on the isolated preview service, not the public Coming Soon service:

    RUVANAS_PRIVATE_PREVIEW_ENABLED=1
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS=approved individual account emails separated by commas
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL=the designated owner's approved account email
    RUVANAS_PUBLIC_URL=the verified HTTPS origin of the private preview
    RUVANAS_PUBLIC_COMING_SOON_URL=https://www.ruvanas.com/

Replace the descriptive values before enabling the service. The owner must be an existing SUPER_ADMIN whose email is also allowlisted. Tester accounts and least-privilege roles must be separately provisioned by the approved operator; issuing codes does not provision them.

The flag accepts exactly 1 to enable and 0 or unset to disable; other values fail closed. Enabled preview requires a valid duplicate-free email list, an approved designated owner and a distinct configured HTTPS preview origin. Redirects use this configuration, not client-supplied hosts or internal localhost addresses.

Use a separate development database with approved test accounts and synthetic organisations. Do not copy production databases or supplier, storage, billing, broadcast or notification secrets. Generate fresh preview session and encryption secrets through the hosting secret mechanism. Start only the existing start:web process, not the production supervisor or audio/operations workers. Health at /api/private-preview/health returns only OK for valid enabled configuration, 503 for invalid configuration and 404 when disabled.

## First owner code and recovery

The first code is required before the owner can reach the online issue controls. There is no public bootstrap endpoint or password-login bypass.

A trusted server operator can invoke node scripts/private-preview-owner-code.mjs --issue-owner-code in a private interactive terminal with the approved preview server environment and the separate one-run flag RUVANAS_PRIVATE_PREVIEW_BOOTSTRAP_APPROVED=1. First verify the database is the approved isolated preview database; the flag and typed confirmation attest that check, not prove it automatically. The helper loads no dotenv file and credentials must not appear in command arguments.

The helper refuses piped or redirected input/output before database access. After typed confirmation it checks the existing owner, issues a self-code and displays it once only in the human terminal. It neither creates accounts nor writes a code file. Disable transcript/screen recording, do not run it through captured tool output, and never paste real codes into chat. Clear the terminal after securely recording or redeeming the code and remove the one-run flag. The same controlled process can recover owner access when no valid owner session remains.

## Local acceptance evidence

On 11 October 2026 all 25 focused tests and all 20 synthetic real-HTTP cases passed with a fresh production-mode build. The disposable loopback database applied the existing 127 migrations; no schema or dependency change was introduced.

Coverage includes owner bootstrap through the trusted core helper, native form redemption and cookie issuance, owner/tester access, nonowner administrator denial, concurrent single-use redemption, replay/expiry/supersession/revocation, password-session bypass denial, logout, rate limiting, anonymous page/API/asset/RSC/subrequest denial, authenticated registration denial, invalid configuration and ordinary preview-off password login. Account, organisation and subscription counts and password hashes were unchanged by the code journeys.

The passing record is preview-2026-10-11-67f05cad23059b7d, build QeVHNS2ppy4uHnYR_o7JK, tested on local parent 7715549fd19e661cd86ac7895ab6575ea589f580 with source digest 8104cabbbb6cc44471842e9183bba1ad4127e20d5dbbb584cdf8c5cb3daea109. All owned services stopped, synthetic users were removed and ports were verified free. Only documentation changed after this implementation snapshot.

Earlier password-preview results remain historical, not acceptance evidence for code-only login. Manual terminal delivery has safe preflight tests; real owner-code delivery, hosted HTTPS, browser cookies and trusted proxy/rate-limit headers still require checks on approved preview infrastructure.

## Publication boundary

Before making this online, approve the hosting service, isolated database, hostname and any cost; provision owner/tester accounts; configure fresh secrets; and verify hosted access. Keep automatic production deployment disabled. Do not merge main, run production migrations or change public-domain routing as part of setup.

After hosted checks pass, publish only a Log in link on the existing Coming Soon cover to the verified preview origin's /login. No link, real code or live preview URL has been created yet. Public registration stays closed until the owner explicitly approves a later launch change.
