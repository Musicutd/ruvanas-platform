# Stage 11B — Controlled Player Commands and Replacement Operations

Stage 11B adds a deliberately narrow remote-operations layer to the existing enrolled web player. It preserves playback, scheduling, proof-of-play, heartbeat sampling, and incident evidence while enabling safe diagnosis and device replacement.

## Delivered scope

- Four allow-listed commands only: connection check, state refresh, playback-plan refresh, and bounded diagnostics.
- Commands expire after 5–60 minutes, are claimed by one enrolled player, and can be acknowledged only once.
- Acknowledgements retain only app version, manifest version, source status, a bounded result code, and a short operational message.
- Platform Support and Super Admin roles can request or cancel diagnostics.
- Only the Super Admin can revoke a player session or create a replacement.
- Replacement disables the old player, clears its session and enrolment credentials, cancels outstanding commands, and creates a new 24-hour one-time enrolment code for the same organisation and zone.
- The old player is retained with its heartbeat, incident, command, and proof-of-play history.
- Request, delivery, acknowledgement, cancellation, revocation, and replacement actions are audited.

## Safety boundary

Stage 11B does **not** provide remote restart, mute, volume, playback, schedule, content, browser-navigation, or arbitrary-payload commands. A failed or unsupported diagnostic cannot change the playback plan. Expired commands are closed by the operations worker and are never delivered later.

## Rollback boundary

The migration is additive. Application rollback may leave the new tables and nullable player lifecycle fields in place. Once command or replacement evidence exists, do not drop it during an application rollback; preserve it for audit and incident review.

## Verification

The release gate requires schema validation, a clean migration sequence, unit tests for the allow-list and bounded evidence, a database lifecycle test, integration authorization tests, and a production build.
