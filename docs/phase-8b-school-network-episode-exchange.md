# Stage 8B — Verified School Episode Exchange

Stage 8B implements the master specification's controlled School Network exchange. It lets active schools in the same Ruvanas academy network offer staff-approved episodes to one another without creating an open social network or exposing student identities.

## Guarded workflow

1. A source-school owner or manager selects an approved episode with an approved audio master.
2. Ruvanas checks every student contributor has a current consent record. Staff must separately confirm the cross-school safeguarding check.
3. The network library exposes only a safe title, summary, source-school name, language, duration, and availability. Episode IDs, audio IDs, users, consent records, and contributors remain private.
4. A receiving-school owner or manager submits an intended-use request of at least 20 characters.
5. A source-school owner or manager approves or declines the request. Approval rechecks the episode, audio, consent, source school, receiving school, and network state.
6. The receiving school can import approved audio as a local School Radio announcement in `IN_REVIEW`. It cannot be scheduled until the receiving school's normal review path approves it.
7. The source school can revoke an approved grant. Revocation archives the imported announcement, cancels future broadcast slots, and prevents the player compiler from using the foreign audio.

## Data and tenant boundaries

- Only active schools attached to the same `SchoolNetwork` can exchange content.
- School attachment remains a SUPER_ADMIN action, so an active network school is the verified-school boundary.
- `SchoolEpisodeExchangeOffer` stores an immutable safe metadata and approved-audio snapshot.
- `SchoolEpisodeExchangeRequest` records the receiving school, intended use, two-school decision, import, and revocation lifecycle.
- A local `SchoolAnnouncement.sourceExchangeRequestId` links an import to the exact approved grant.
- Foreign audio is playable only when the local announcement is approved, the request remains `APPROVED`, the offer remains `AVAILABLE`, the target organisation matches, and the offer's exact approved audio version matches.
- No student account, private message, public feed, contributor identity, raw consent evidence, or source-school user identity crosses the school boundary.

## Audit evidence

Every offer, pause, resume, withdrawal, request, decision, import, cancellation, and revocation writes a network-aware audit event under `school-network-exchange-v1`. Cross-school exposure is explicitly marked only when approved audio is imported; student identity exposure remains false.

## Failure and withdrawal behaviour

- Pausing or withdrawing an offer prevents new imports and playback through that offer.
- Consent and approval are rechecked before resuming an offer or approving a request.
- Revocation takes effect at the data, schedule, and player-compilation layers.
- Existing retail, in-house radio, public podcast, and digital-signage flows do not depend on this feature.

## Test coverage

Unit tests cover approval and consent gates, staff-only episodes, bounded transitions, redaction, meaningful intended use, and revocable foreign-audio playback. Route-security coverage treats the exchange API as an authenticated School Radio route. CI validates the additive migration and production build.
