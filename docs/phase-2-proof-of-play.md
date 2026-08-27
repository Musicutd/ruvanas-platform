# Phase 2: proof of play

This milestone turns scheduled playback intent into confirmed operational evidence without trusting arbitrary browser claims.

## Confirmation flow

- Each playable manifest item contains a server-signed proof token bound to the player, manifest version, and track.
- The web player records `STARTED`, `COMPLETED`, and `FAILED` events with a client-generated UUID.
- Events are queued in browser storage when the network is unavailable and retried after connectivity or the next heartbeat.
- `POST /api/player/proof-of-play` accepts at most 100 events per request, authenticates the enrolled player, validates timestamps and signed attribution, and stores accepted events transactionally.
- The database uniqueness constraint on player and client event ID makes retries idempotent.

## Reporting

`/admin/proof-of-play` shows 24-hour starts, completions, failures, completion rate, active-player count, and the 100 most recent confirmations. Snapshot names are stored with each event so operational reports remain understandable after ordinary catalogue or player edits.

## Security and retention

- Direct storage keys and signing secrets never reach the player.
- A proof token cannot be reused for another player, manifest, or track.
- Events more than 30 days old or more than five minutes in the future are rejected.
- Proof records remain organisation-scoped and retain the player, zone, track, media asset, manifest version, client occurrence time, and server receipt time.

## School Radio reuse

Approved School Radio episodes and broadcast slots should later emit through the same idempotent ingestion and reporting boundary. Their future signed content identity can extend the current music-track proof without creating a second confirmation system.

## Next milestone

Begin Phase 3 with versioned promo assets and campaigns, then compile their targeting, priority, and recurrence rules into the same secure player manifest and proof-of-play stream.
