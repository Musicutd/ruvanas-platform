# Stage 18K — Secure Account Recovery & Password Reset

## Subscriber experience

- A clear **Forgot your password?** action is available from sign-in.
- Accepted requests receive the same privacy-preserving confirmation. Missing email configuration returns a service-unavailable message for every address.
- Recovery links expire within 30 minutes and work once.
- The token stays in the URL fragment, is removed from the address bar immediately, and is never sent in a page request or stored in plaintext.
- A successful reset signs the account out everywhere and returns the subscriber to sign-in when that route is available. A closed private pilot instead shows completion without opening access.
- Company-managed identities continue through their organisation's sign-in method.

## Security controls

- Request and reset attempts have separate rate limits.
- Unknown accounts, student accounts and SSO-only accounts cannot create usable reset records.
- Passwords require at least 12 characters and at most 72 UTF-8 bytes, including a letter and number, and cannot reuse the current password.
- Only a SHA-256 token fingerprint is stored. New requests consume previous links.
- The database claims a token atomically before changing the password.
- Audit records contain safe identifiers and expiry/session outcomes, never the token or password.
- Provider calls retain the existing public-endpoint, no-redirect, timeout, bearer-token and safe-failover controls.

## Operational setup

Set `RUVANAS_PUBLIC_URL` to the Ruvanas HTTPS origin. Account recovery uses the existing `NOTIFICATION_EMAIL_*` adapter settings. Missing delivery configuration returns the same unavailable response for every well-formed address before a user lookup. Account-specific delivery failures retain the neutral confirmation and invalidate their generated link. Provider acceptance does not prove mailbox delivery.

Private preview uses the separate, default-off and time-bounded policy described in [Private-preview account recovery](private-preview-account-recovery.md). It can reset an explicitly approved ordinary Client Admin account while Rewards remains disabled.

The free staging service remains outside this work and must stay suspended.
