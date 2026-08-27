# Phase 2: secure player manifest

This milestone connects the schedule resolver to enrolled Ruvanas players.

## Playback plan

- `GET /api/player/manifest` requires the player's HTTP-only enrolment cookie.
- The server evaluates opening hours, effective dates, location and zone schedules, active Music Modes, and ready catalogue tracks.
- A manifest lasts five minutes and asks the player to refresh after four minutes.
- Track order is weighted but deterministic for the player and manifest window, preventing unstable reshuffles during refreshes.
- Responses contain catalogue metadata and same-origin player media URLs only. R2 storage keys, credentials, and direct object URLs are never exposed.
- Closed, unscheduled, disabled, and empty-mode states return no playlist.

## Protected audio

`GET /api/player/media/:mediaAssetId` authenticates the player, recomputes its current playback plan, and streams only a ready catalogue track in the resolved active Music Mode. Byte ranges are supported for browser audio seeking. A player cannot request another organisation's media or a catalogue track outside its current plan.

## Web player

The existing player now refreshes its manifest automatically, advances through the playlist, displays the current Music Mode and track, and retains the configured live channel as a fallback.

## Next milestone

Add proof-of-play ingestion with idempotent event IDs, manifest version attribution, offline retry, and operational reporting. The same confirmation pipeline will later support approved School Radio episodes and broadcast slots.
