# Private-preview account recovery

This change repairs recovery for an existing ordinary Client Admin. It creates no
account, session, subscription, entitlement or Rewards access. No database
migration, registration setting, encoder or audio delivery change is required.

## Scoped, temporary operation

Recovery remains closed by default in private preview. A reviewed temporary
configuration must contain all three values:

```text
RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ENABLED=true
RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ACCOUNTS=[{"userId":"synthetic-owner","organisationId":"synthetic-shop","email":"shop@example.invalid"}]
RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_EXPIRES_AT=<explicit future UTC ISO timestamp>
```

The deadline must be in the future and no more than 24 hours away. Values above
are a synthetic example, not instructions to enable any real account. Resolve
the exact existing account through authorised administration before configuring
the window. Accounts must be ordinary OWNER/MANAGER identities with a matching
membership and email, no tester identity and no SSO-only restriction. Duplicate,
ambiguous, incomplete and malformed scopes fail closed. Both issuance and reset
recheck this authority. Disabling the policy or reaching the deadline makes
outstanding links unusable in private preview. Changing the account email while
the approved email stays pinned also denies recovery. Before an operator changes
the approved email scope, outstanding tokens must be invalidated: the current
token format does not record the email that owned the account at issuance.

The middleware admits only the two recovery pages, their exact POST APIs, and
read-only Next static assets. Origin and size checks remain active. The server
independently checks account eligibility, so a page or valid token alone grants
no password change. Registration and all Rewards flags remain independent.

## User flow

1. An existing user opens the recovery page and requests a link to their email.
2. The configured provider receives the one-time link. It contains the token in
   the URL fragment; the browser removes the fragment on first render.
3. The user privately enters and submits their new password. It must include a
   letter and number, have at least 12 characters and fit within 72 UTF-8 bytes.
4. The reset changes only that account's password, consumes its reset tokens and
   revokes its existing sessions. It does not sign the user in automatically.
5. If the separately approved pilot is closed, the page confirms the reset and
   explains that the administrator will arrange the next private sign-in.

Links expire within 30 minutes, or earlier when the recovery window closes.
Issuance and reset lock the existing User inside a serializable transaction.
Consumption rechecks time after hashing and lock acquisition; competing resets
cannot both use a token. Membership and SSO authority are read again inside the
transaction. No password or raw token is stored in application evidence or logs.

## Email delivery prerequisite

The default adapter expects an authorised public HTTPS endpoint accepting JSON
`{from,to,subject,text,idempotencyKey}`, Bearer authentication and an
`x-idempotency-key` header. It needs `NOTIFICATION_EMAIL_ENDPOINT`,
`NOTIFICATION_EMAIL_TOKEN` and `NOTIFICATION_EMAIL_FROM`. A provider's endpoint
must be verified against that contract; a mailbox or SMTP host is not enough for
that HTTPS transport. An explicit recovery-only SMTP option is documented below.
Do not add a paid provider or transfer private credentials without the required
authorisation. Configure secrets through the hosting provider's supported UI.

With no provider configured, every well-formed request receives the same 503
before looking up an account. A configured provider's individual failure keeps
the neutral confirmation and invalidates the token. A 2xx provider response is
acceptance, not proof of inbox delivery. SMTP acceptance has the same limitation.
A real inbox receipt is a release check.
Local tests inject delivery stubs and send no email.

### Existing mailbox through verified SMTP

The recovery-specific adapter can use the already approved `info@ruvanas.com`
mailbox without configuring a new provider or changing operational notifications:

```text
ACCOUNT_RECOVERY_EMAIL_TRANSPORT=smtps
ACCOUNT_RECOVERY_SMTP_HOST=mail.ruvanas.com
ACCOUNT_RECOVERY_SMTP_PORT=465
ACCOUNT_RECOVERY_SMTP_USER=info@ruvanas.com
ACCOUNT_RECOVERY_SMTP_PASSWORD=<enter privately in the website service's secret field>
```

Only this exact host/user/port combination is accepted. The From address and
SMTP envelope sender come from that username; callers cannot override them.
Do not put the mailbox password in source, a shell command, an evidence file,
chat or screenshots. These variables belong to the website service only.
Neither encoder requires them. With no explicit transport, HTTPS remains the
default. A malformed or incomplete SMTP selection fails closed; it does not
fall back to an HTTP provider or another mailbox.

DNS is resolved once to IPv4; every returned address must be public. The chosen
address is pinned for that send, while TLS verifies `mail.ruvanas.com` with
certificate verification enabled and TLS 1.2 or later. IPv6-only, internal and
mixed public/private answers are rejected. The message has one strictly parsed
recipient, plaintext only, and file/URL loading is disabled. No pooled
connections, transport logging or debug logging is enabled. Eight-second
connection/greeting/socket deadlines and a 15-second overall DNS-and-send
deadline bound delivery. The Nodemailer 10.6.1 AbortSignal closes an active
connection; `socketCloseTimeout: 0` prevents a lingering teardown grace period.

There is one SMTP attempt, without retry or failover, even after an authentication
failure or ambiguous disconnect/timeout. The server may already have accepted
the message. The existing recovery service invalidates the reset token if
delivery cannot be confirmed, and gives the same neutral account response.
Provider responses, credentials and reset links never appear in returned
delivery errors. Removing the SMTP variables closes this option; check the
default HTTPS configuration separately when rolling back. This configuration
does not open the private-preview recovery window, Rewards or registration.

Local tests cover the configuration boundary, pinned IP and TLS options,
recipient injection, DNS rejection/late completion, timeouts and sanitized
errors, unchanged HTTPS behavior, and the actual installed Nodemailer's
cancellation against an in-memory SMTP peer. They do not contact a mail server.
Authenticated SMTP acceptance and inbox receipt remain hosted release checks.
See the primary [SMTP documentation](https://nodemailer.com/smtp) and
[message security/cancellation documentation](https://nodemailer.com/message).

## Validation and limits

Behavioural tests cover default-off policy, exact account/email/organisation
scope, unsafe methods/origins, rate limits, body bounds, missing delivery,
UTF-8 boundaries and closed-pilot completion. The isolated Node 20/PostgreSQL 16
suite covers expiry during hashing, token races, failed delivery, session
revocation and unchanged unrelated records. It requires an explicitly owned
loopback fixture and cannot use an application database connection.

The inherited synchronous email path has a residual timing distinction: the
700 ms minimum response time does not hide a slow eligible-account provider
call. Response bodies never disclose account existence or delivery outcome, and IP
and subject limits constrain requests, but full timing indistinguishability
would require a separately reviewed asynchronous delivery design. Ordinary
non-preview recovery retains its existing eligibility policy and token format;
the private preview email binding does not retrofit email-at-issuance data into
legacy ordinary recovery tokens.

Publication and live email setup require a separate release decision. Keep
Rewards disabled, registration closed and both encoders untouched throughout
the local work. Remove the temporary recovery settings after the user completes
recovery; verify the pages/APIs return closed again and retain only safe evidence.
