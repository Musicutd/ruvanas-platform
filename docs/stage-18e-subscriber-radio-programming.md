# Stage 18E — Subscriber Radio Programming Workspace

## Purpose

Stage 18E gives each subscriber a clear, safe place to plan its own radio week without exposing Ruvanas catalogue administration. Organisation owners and managers can assign approved music modes to active locations or zones, preview the full week and publish a controlled new schedule version.

## Subscriber experience

- A live overview shows the music mode currently scheduled for every active location and zone.
- The weekly planner uses familiar day, start-time, end-time and approved-music-mode controls.
- A visual seven-day preview is mandatory before a plan can be published.
- Plans can be saved as drafts without changing the live service.
- Publishing creates a new version and archives the previously published plan for the same target.
- Existing live or draft plans can be copied into the planner as a safe starting point.
- Current, upcoming and bounded-date plans remain visible with their location, version and programme count.
- Owners and managers may edit; content editors and viewers receive read-only access.

## Catalogue and tenant protection

- The active organisation is always derived from the authenticated session and is never accepted from the request body.
- Locations, zones, modes and schedules are restricted to that organisation.
- Only active music modes already approved for the organisation may be scheduled.
- The global Music Catalogue remains exclusively under the existing Ruvanas Super Admin controls.
- Subscriber programming does not create tracks, change rights metadata or alter music-mode approval.

## Commercial and operational boundaries

- The programming workspace is available only while the subscriber's radio service entitlement is enabled.
- Existing station and simultaneous-stream limits remain enforced by the established player and stream-session controls.
- Schedule changes are recorded in the audit log with the actor, target, version, slot count and preview acknowledgement.
- No database migration or new environment variable is required.
- The free staging service remains outside this stage and must stay suspended.

