# Phase 1: authenticated player identity and health

This slice completes the first operational loop from the product architecture:

1. Ruvanas operations creates a persistent player for a subscriber zone.
2. The platform issues a single-use enrolment code that expires after 24 hours.
3. The playback browser enrols at `/player` and receives an HTTP-only device cookie.
4. The player resolves only the friendly channel assigned to its zone and the minimum stream data required for playback.
5. A heartbeat is sent every 30 seconds; the operations view treats a player as offline after 90 seconds without a heartbeat.
6. Creation and enrolment are recorded in the organisation audit trail.

## Security boundaries

- Player creation remains restricted to Ruvanas platform administrators.
- Enrolment and session tokens are random 256-bit values and are stored only as keyed SHA-256 hashes.
- Enrolment codes are single use and expire after 24 hours.
- Player cookies are HTTP-only, secure in production, strict same-site, and scoped to the Ruvanas origin.
- A player can read only its assigned zone, friendly channel, and playable stream URL.
- Disabled or unknown players receive `401` responses from state and heartbeat endpoints.
- All unsafe API requests continue to require an approved same-origin request.

## Operational status

- `PENDING ENROLMENT`: player created but no device has claimed it.
- `ONLINE`: most recent heartbeat is within 90 seconds.
- `OFFLINE`: enrolled player has not sent a heartbeat for more than 90 seconds.
- `DISABLED`: player is blocked by Ruvanas operations.

This intentionally establishes the identity and health foundation before offline caching, dedicated hardware, remote commands, health incidents, and alert delivery are added.

