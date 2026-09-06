# Stage 19.14 — Public Player

## Outcome

Stage 19.14 gives an active Online Radio station a professional public listening page and a compact website embed. Both use the existing Stage 19.6 Unified Playout Engine, Stage 19.7/19.9 protected live-source path, Stage 19.1 synchronized AutoDJ clock, Stage 19.12 audio outputs and Stage 19.13 privacy-safe analytics. It does not introduce a second scheduler, station identity, media library or streaming credential path.

Subscribers manage the player from the station workspace. Publishing is deliberately off by default and requires an organisation owner or manager, an active station, an active channel and an assigned listening zone.

## Listener experience

- `/listen/[station-slug]` provides the full branded player.
- `/embed/[station-slug]` provides the same protected player in a compact iframe-ready layout.
- The player displays safe station branding, channel identity and current programme metadata.
- Synchronized recorded programming retains the shared channel clock and two-second mix.
- Healthy external live programming and the existing configured stream fallback are relayed through protected same-origin routes.
- Browsers that block autoplay receive an explicit start control rather than a false live state.

## Public/private boundary

The public station discovery response no longer exposes the upstream stream URL. Public manifests omit organisation IDs, source credentials, provider account information, storage keys, enrolled-player IDs, proof-of-play authority and internal resolver evidence. Media and live URLs carry a short-lived signed authority scoped to one organisation, station, channel and anonymous listener-session hash.

The server re-checks all of the following before each protected audio response:

1. the station is active and explicitly published;
2. its subscription or controlled complimentary access remains active;
3. the selected channel is active and still assigned;
4. the anonymous listener lease is current;
5. the requested media or live source belongs to the current public playout decision.

## Capacity and privacy

Each browser creates a private random session ID. Ruvanas stores only its keyed SHA-256 hash. No listener name, account, email address, raw IP address or raw user-agent string is stored. A 90-second renewable lease enforces the lower of the station and effective-plan listener limits. Expired leases release capacity automatically.

The public manifest issues the short-lived Stage 19.13 telemetry token. The player reports session start, bounded 30-second heartbeats, session end and playback errors. Analytics remain operational estimates, not identity, billing, advertising or royalty evidence.

## Subscriber controls

Owners and managers can:

- publish or unpublish the public player;
- set a bounded listener-facing tagline and accent colour;
- preview the public page;
- copy a safe iframe embed;
- see the listener capacity applied to the station.

All publication changes create tenant-owned audit evidence. Unpublishing fails closed on the next manifest or audio-authorisation request without affecting enrolled Retail or School Radio players.

## Rollback

Unpublish each public player first and allow its 90-second leases to expire. Application rollback leaves the additive branding fields and anonymous leases dormant. The migration can be reversed after active leases are gone. Do not remove stations, channels, schedules, media, enrolled-player leases, proof of play or Stage 19.13 aggregates as part of this rollback.
