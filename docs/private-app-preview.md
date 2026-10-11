# Private Ruvanas app preview

The public website at https://www.ruvanas.com/ must continue to show Coming Soon. The owner and invited testers will enter the working Ruvanas app through a separately approved preview origin, using individual Ruvanas email addresses and passwords. Promo Only passwords and API credentials are not preview credentials.

This change is prepared in an isolated development branch. It has not been merged, published or deployed, and no live account, DNS or Render setting has changed. The public cover was observed on 11 October 2026 with its Coming Soon title and HTTP 503 status; that observation is not a verification of its underlying hosting configuration.

## Access behavior

Preview mode is off by default. When enabled, every app page, API and asset requires both a valid database-backed Ruvanas session and an explicitly approved email address. Existing roles and organisation permissions still apply; being invited does not grant administrator privileges.

Only the no-JavaScript sign-in page, login/logout endpoints and a minimal health endpoint are available before sign-in. Anonymous requests to the preview root return to the public Coming Soon site. Direct links to app pages go to preview sign-in; APIs return 401 and assets return 404. Public registration, password-recovery and demo routes do not become alternative entry points.

The form posts email and password to the existing login handler. It retains password hashing, login rate limiting, secure HTTP-only session cookies, session expiry and revocation. Error redirects contain fixed error codes, never email addresses, passwords or session tokens. Preview responses are not cacheable and request no search indexing.

Invalid preview configuration or a failed session lookup denies access. A cookie, role header, service-account token, RSC query or hidden homepage control does not independently authorize preview access.

## Server configuration

Set these values only on the isolated preview service, not the public Coming Soon service:

```text
RUVANAS_PRIVATE_PREVIEW_ENABLED=1
RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS=approved individual Ruvanas account emails separated by commas
RUVANAS_PUBLIC_URL=the verified HTTPS origin of the private preview service
RUVANAS_PUBLIC_COMING_SOON_URL=https://www.ruvanas.com/
```

The values describing emails and the preview origin above must be replaced with the approved real values before enabling the service. The preview flag accepts exactly `1` to enable and `0` or unset to disable. Other nonempty values fail closed. An enabled preview requires a nonempty, valid, duplicate-free email list, the verified HTTPS browser-facing preview origin in `RUVANAS_PUBLIC_URL`, and a valid HTTPS public return URL. The preview origin must differ from the Coming Soon origin. Protected-page redirects use that configured preview origin, not request headers or the server's internal localhost address. The allowlist belongs in server-side configuration, not in browser JavaScript or the public cover.

Use a separate development database containing approved test accounts and synthetic organisations. Do not reuse a production database or copy production secrets, supplier credentials, storage, billing, broadcasting or notification integrations. Generate fresh preview session and encryption secrets through the hosting secret mechanism; never place passwords or secret values in Git or chat.

Start only the Next web process with the existing `start:web` command and the hosting port. Do not use the production supervisor: it can start operations and audio workers when their environment is present. The preview health path is `/api/private-preview/health`; it returns only `OK` for valid enabled configuration, 503 for invalid configuration and 404 when preview is disabled.

## Validation

Eleven focused local tests pass for preview policy, shared session lookup and sign-in source checks. The final targeted disposable PostgreSQL and real HTTP run passes all 13 cases, including owner/tester login, outsiders with otherwise valid passwords, direct page/API/asset access, RSC/prefetch and middleware-header attempts, bad Origin, logout, revoked/expired sessions, invalid configuration and normal preview-off behavior. The build passed with the unchanged 127 migration set. All owned services stopped, test users were removed and both loopback ports were verified free.

The original failed runs remain retained. They exposed a first cold-request timeout, an unsafe internal-origin assumption and a rejected relative middleware redirect. The corrected implementation uses a validated configured private origin. A later constructor-only check established that NextURL normalizes loopback IP redirects to localhost; the local fixture was corrected without weakening production validation or rebuilding unchanged code. The final passing run is `preview-2026-10-11-8d8072446a74a397`, with build `4XoPI7QAIeyiHlYxsyMK6`. This is synthetic local HTTP evidence; hosted TLS, browser behavior and real account setup remain publication gates. Only this documentation was updated after the final tested source snapshot; implementation files were unchanged.

Required HTTP cases include anonymous root/page/API/assets, native sign-in with a valid invitation, denied outsiders despite correct passwords, bad Origin, logout, revoked/expired sessions, direct-link and middleware-header bypass attempts, invalid configuration and normal preview-off behavior. Browser and HTTPS hosting checks remain required on the approved preview origin.

## Publication boundary

Before publishing, confirm the preview service, isolated database, cost and hostname; approve their creation or reuse; select individual owner/tester accounts and their least-privilege roles; and verify the hosted access checks. Keep automatic production deployments disabled. Do not merge main, execute production migrations or change the public domain routing as part of preview setup.

After the preview origin passes its checks, add a small Private preview sign in link to the existing Coming Soon cover, pointing to that verified origin's `/login` page. Do not add a browser-only password, cross-origin password-posting form or a placeholder preview URL to the live cover. Publishing that link requires its own approved cover update.

To revoke a tester, remove the approved email from preview configuration and revoke their Ruvanas sessions through the normal account controls. The preview gate checks the current database user and allowlist on each protected request. Existing application permissions remain authoritative underneath the gate.
