# Studio E — Visual multitrack editing

Studio E turns the existing Multitrack tool into an approachable visual timeline. It reuses the protected source library, non-destructive clip state, immutable project versions, server audio worker, loudness checks and teacher approval flow introduced before Studio E.

## User journey

- Each track has a scrollable time ruler and visual clip blocks sized and positioned against the real project timeline.
- An unlocked clip can be dragged along its current track or dropped onto another unlocked track. Its protected source range is unchanged.
- Keyboard users can focus a clip and use the left or right arrow to move it by 0.1 seconds, or hold Shift to move it by one second.
- A timeline zoom control provides a compact overview or a more precise editing scale without changing saved audio decisions.
- Existing numerical start and fade controls remain available for exact values.

## Crossfades

Adjacent clips on the same track have an explicit transition control. Increasing the crossfade overlaps the incoming clip, applies a bounded fade-out to the first clip and a bounded fade-in to the second clip. Setting the control to zero restores a clean adjoining edit. The protected server worker remains the only authority that renders those decisions.

## Plan-aware limits

School Start, School Create and School Pro projects support up to eight tracks. School Academy and Education Enterprise projects support up to sixteen tracks. The active limit is returned by the protected API, displayed in the workspace, used by the client controls and enforced again when the server saves or queues a render. Existing projects are not deleted or rewritten when a plan changes.

## Safety and boundaries

Studio E adds no database migration, public media route, billing event, subscription mutation or third-party audio transfer. Organisation membership, School Radio entitlement checks, licensed source validation, approval invalidation and immutable source audio remain unchanged. Product publishing destinations remain Studio F work.
