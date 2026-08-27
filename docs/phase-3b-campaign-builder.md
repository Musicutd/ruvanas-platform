# Phase 3B: Promotional campaign builder

Phase 3B turns an approved, immutable `PromoVersion` into an organisation-owned campaign draft that can be previewed and published without silently switching audio versions.

## Campaign structure

- `Campaign` stores lifecycle, priority, mandatory status, effective dates, opening-hours policy, safety limits, publication revision, publisher, timestamp, and the hash of the exact published configuration.
- `CampaignTarget` supports all locations, brand, location group, location, and zone. Database constraints require exactly the matching typed foreign key.
- `CampaignRule` stores campaign-wide plays-per-hour, interval, and exact-time behavior.
- `CampaignSchedule` stores weekday-local time windows, exact times, and advanced daypart overrides.

## Supported scheduling modes

- Plays per hour
- Minute interval
- Exact local times, with optional hard-start intent
- Advanced dayparts with per-window plays-per-hour or interval rules
- Smart priority, mapped deterministically from Low, Normal, High, or Very High

## Preview and publication safety

The server expands every target to concrete organisation-owned playback zones, estimates plays over the campaign date range, and checks:

- the selected promo version is approved, active, ready, and belongs to the organisation;
- campaign windows do not overlap, including overnight carry-over;
- frequency respects the minimum same-promo gap;
- estimated promo minutes per hour stay below the configured limit;
- targets resolve to at least one active zone;
- missing opening-hours configuration is visible;
- overlapping published campaigns, especially mandatory campaigns, are reported.

Publication repeats all checks inside the trusted server boundary. A campaign that fails a blocking guardrail remains a draft. Successful publication records an incrementing revision, a deterministic SHA-256 configuration hash, the actor, the resolved target count, estimates, warnings, and an audit event.

Mandatory corporate campaigns can only be created, published, paused, or archived by a Ruvanas Super Admin. Organisation content roles may prepare normal drafts; organisation owners/managers may publish normal campaigns through the API.

## Compatibility

- Existing music schedules, player enrolment, heartbeat, protected media, and music playback manifests are unchanged.
- Campaigns reference exact `PromoVersion` records and never follow a newly approved version automatically.
- Phase 3C merges published campaign occurrences into the player schedule/manifest and extends proof-of-play from music tracks to immutable campaign promo-version intents. See `docs/phase-3c-campaign-playout.md`.
