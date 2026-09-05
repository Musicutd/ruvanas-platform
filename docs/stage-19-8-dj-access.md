# Stage 19.8 — Scoped DJ Access

## Outcome

Stage 19.8 lets an organisation owner or manager give a named presenter access to one active channel for a defined show window. It reuses the existing Ruvanas user, organisation, team, subscription, audit and External Live systems. It does not create a second presenter identity or authentication platform.

## Controlled workflow

1. The manager selects an existing organisation member and active channel.
2. The manager sets a 15-minute to 12-hour window and selects explicit capabilities.
3. Ruvanas creates one private access link. Only a secure hash is stored, and the raw link is shown once.
4. The presenter signs in with the named Ruvanas account and opens the private link. A different account cannot exchange it.
5. The access cookie is HttpOnly, SameSite Strict, production-secure and bounded by the grant end.
6. The manager may replace the link or revoke the grant immediately. Either action invalidates the previous browser access.

## Permission boundary

- Every grant includes `VIEW_CHANNEL`.
- `CONTROL_EXTERNAL_LIVE` permits connection testing, taking the granted channel live and taking it off air. It never permits viewing or changing upstream credentials, creating sources or archiving sources.
- `START_BROWSER_STUDIO` is the authority Stage 19.10 will require before a presenter can start a browser studio session.
- `RECORD_LIVE_SESSION` requires Browser Live Studio permission and remains dormant until the governed recording workflow exists.
- Owners and managers retain their existing authority and do not need a DJ grant.

## Security and data invariants

- A grant belongs to one organisation, channel and existing member identity through database foreign keys.
- A partial unique index permits only one open grant for the same presenter and channel.
- A second partial unique index permits only one unrevoked token for a grant.
- Access fails closed before the window, after it, after token expiry, following rotation or revocation, for a different user, organisation or channel, and when a required capability is missing.
- Grant, token rotation and revocation actions produce tenant-bound audit evidence without recording the raw token.
- Presenter APIs never return upstream stream URLs, credentials or token hashes.

## User experience

Managers issue and monitor grants inside Radio Programming. Presenters open a dedicated, plain-language access page which confirms the channel, window and permissions. With External Live control, the normal Programming page exposes only permitted actions for the granted channel. Source configuration remains manager-only.

## Rollback

Application rollback makes DJ grants dormant because older releases do not query them. Revoking open grants before a database rollback is recommended so access evidence remains explicit. External Live, scheduled programming, AutoDJ, Retail Radio and School Radio continue through their existing paths.

