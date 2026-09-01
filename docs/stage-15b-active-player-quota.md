# Stage 15B — Active player quota

## Purpose

Stage 15B prevents a subscriber from using more simultaneous in-house player streams than the organisation's plan permits. The existing plan `streamLimit` remains the commercial source of truth: a one-stream tier can run one active shop player, while higher tiers can run their allowed number concurrently.

## Behaviour

- Each browser player presents a private per-tab instance identifier.
- The server grants a renewable 90-second listener lease when capacity is available.
- State, manifest, and heartbeat requests renew the same lease instead of consuming another slot.
- A different browser or device receives a clear `429` refusal when all plan slots are occupied.
- Closing the player attempts an immediate release; missed heartbeats release abandoned slots automatically.
- Protected media URLs carry a short-lived signed listener token and are served only while the matching lease remains active.
- The client dashboard reports active shop streams against the subscribed stream allowance.

## Operational notes

- Listener leases contain only tenant, enrolled-player, hashed browser-instance, and expiry metadata.
- The raw browser instance identifier is not stored.
- Serializable transactions protect the quota boundary from concurrent claims.
- Plan changes take effect on the next lease renewal. Earlier lease holders retain the available slots deterministically after a downgrade.
- A legacy Super Admin-created organisation without a subscription record receives one controlled test slot until a plan is attached; registered subscribers always use their plan allowance.

