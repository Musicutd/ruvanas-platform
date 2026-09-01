# Stage 15E — Subscriber shop-player setup

## Purpose

Stage 15E lets client organisations prepare and replace their own shop players without granting platform administration access. Each configured player represents one subscribed shop or playback zone and remains protected by the active-session quota and Stage 15D device lock.

## Subscriber controls

- The client dashboard links to a tenant-scoped **Shop players** area.
- Owners and managers can prepare a player for one of their organisation's zones.
- Configured, non-disabled players cannot exceed the subscription's simultaneous-shop allowance.
- Content editors and viewers can inspect player status but cannot create or replace devices.
- One-time enrolment codes are shown once and expire after 24 hours.
- Every creation or replacement preserves organisation audit evidence.

## Safe replacement

- Replacement requires an explicit confirmation and an operational reason.
- The old player session, active listener lease, and pending commands are invalidated immediately.
- The replacement remains bound to the same organisation and zone and does not consume an extra configured-player slot.
- Historical health, proof-of-play, and incident evidence remains attached to the retired player.

## Boundaries

The feature does not expose platform-wide organisations, other tenants' zones, raw session tokens, browser fingerprints, or historic network identifiers. Permanent platform support tools remain separate from subscriber self-service.
