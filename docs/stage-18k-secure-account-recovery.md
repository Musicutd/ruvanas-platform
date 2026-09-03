# Stage 18K — Secure Account Recovery & Password Reset

## Subscriber experience

- A clear **Forgot your password?** action is available from sign-in.
- A valid request always receives the same privacy-preserving confirmation.
- Recovery links expire after 30 minutes and work once.
- The token stays in the URL fragment, is removed from the address bar immediately, and is never sent in a page request or stored in plaintext.
- A successful reset signs the account out everywhere and returns the subscriber to sign-in.
- Company-managed identities continue through their organisation's sign-in method.

## Security controls

- Request and reset attempts have separate rate limits.
- Unknown accounts, student accounts and SSO-only accounts cannot create usable reset records.
- Passwords require 12–128 characters, including a letter and number, and cannot reuse the current password.
- Only a SHA-256 token fingerprint is stored. New requests consume previous links.
- The database claims a token atomically before changing the password.
- Audit records contain safe identifiers and expiry/session outcomes, never the token or password.
- Provider calls retain the existing public-endpoint, no-redirect, timeout, bearer-token and safe-failover controls.

## Operational setup

Set `RUVANAS_PUBLIC_URL` to the paid Ruvanas HTTPS origin. Account recovery uses the existing `NOTIFICATION_EMAIL_*` adapter settings. If email delivery is not configured, the public response remains neutral and the generated link is invalidated.

The free staging service remains outside this work and must stay suspended.
