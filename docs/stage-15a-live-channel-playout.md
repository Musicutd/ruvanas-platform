# Stage 15A — Synchronized live channel playout

Ruvanas channels now behave like shared live radio services rather than personal browser playlists.

## Listener behaviour

- Every player assigned to the same active channel receives the same deterministic rotation.
- Refreshing or joining late seeks to the channel's current track position instead of restarting the track.
- Music transitions use a two-second overlap with a linear crossfade.
- Browser autoplay restrictions are handled with a clear **Start live radio** control; starting always rejoins the current live position.
- Proof-of-play remains signed and scoped to the enrolled player.

## Multiple simultaneous streams

- Each channel ID owns an independent programme clock.
- An organisation may activate channels up to its plan's existing `stationLimit`, exposed to the application as `streamLimit` for backwards-compatible billing data.
- Plans with a limit greater than one can run those channels concurrently.
- A technical streaming provider is optional. If configured, its URL remains a fallback; Ruvanas-managed catalogue playout is the primary synchronized source.

## Operational notes

- A live-mixed catalogue track must have a trusted duration greater than the two-second overlap.
- Paused channels are excluded from player assignments.
- Existing schedule, rights, opening-hours, campaign, school-announcement, and proof controls remain in force.
