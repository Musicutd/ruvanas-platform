# Stage 18F — Subscriber Promotions Planner

## Purpose

Stage 18F gives ordinary retail and in-house radio subscribers a clear place to schedule their own approved promotional audio. It complements the Stage 18E music planner without exposing the Ruvanas Music Catalogue, mandatory corporate campaigns, Retail Media orders or platform administration.

## Subscriber experience

- Choose only approved, playback-ready promotional audio belonging to the active organisation.
- Target all active locations, one location or one listening zone.
- Choose campaign dates, weekly time windows and either plays-per-hour or interval scheduling.
- Respect configured opening hours by default.
- Preview playback-zone coverage, scheduling warnings and estimated delivery before saving.
- Save a checked draft as an owner, manager or content editor.
- Publish, pause or archive ordinary subscriber promotions as an owner or manager.
- Review protected corporate and Retail Media campaigns without being able to change them.

## Protection and evidence

- The organisation is always derived from the authenticated active session and is never accepted from the request body.
- The existing campaign resolver rechecks promo ownership, approval, media readiness, target ownership, conflicts and delivery guardrails.
- Preview acknowledgement is required before creating a draft and again before publication.
- Existing publication auditing, configuration hashing and webhook delivery remain in force.
- Estimated plays are explicitly presented as scheduling estimates, not listeners, reach or impressions.

## Operational boundaries

- Promotions are available only while the subscriber's radio service entitlement is active.
- This stage does not change music programming, stream limits, subscription billing or the protected catalogue.
- No database migration or environment-variable change is required.
- The free staging service remains outside this stage and must stay suspended.

