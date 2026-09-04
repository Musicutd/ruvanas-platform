# Stage 19.5 — Advanced Scheduler

## Outcome

Stage 19.5 adds an organisation-owned Advanced Scheduler for Online Radio channels. It schedules typed, approved programme sources in each channel's IANA timezone without replacing the existing retail, School Radio, campaign, AutoDJ or player resolvers.

## Governed schedule contract

- One stable `ProgrammeSchedule` belongs to one tenant-owned channel.
- Every save creates an immutable numbered `ProgrammeScheduleVersion` draft.
- A partial database uniqueness rule permits only one active version per schedule.
- Publishing archives the prior active version atomically and activates the reviewed draft.
- Content editors may prepare versions; only owners and managers may publish or take a schedule off air.

## Programme sources and recurrence

Each ordered programme uses exactly one approved source:

- a playable Music Mode cleared for Online Radio;
- a current, published 60-minute Radio Clock; or
- a current, approved Show Builder rundown.

Programmes may repeat weekly at a local weekday/time or run once at an absolute instant. Durations are bounded to 1–1,440 minutes, priorities to 0–100 and versions to 200 entries. Radio Clock reservations are exactly 60 minutes.

## Preview, conflicts and compatibility

The compiler converts weekly local times to UTC over a bounded 1–31 day horizon and rejects nonexistent daylight-saving times. Equal-priority overlaps block publication. Different priorities are shown as controlled overrides and require explicit acknowledgement before publication.

The preview also reports existing retail schedules and approved School Radio slots affecting areas assigned to the channel. Those systems remain authoritative until Stage 19.6 combines them in the Unified Playout Engine.

## Security and database assurance

- Tenant scope comes only from the authenticated active organisation.
- Composite database relationships bind channels, versions and every programme source to the same organisation.
- Database checks enforce recurrence shape, source shape, state transitions, duration, priority and position bounds.
- Publication revalidates channel status, rights, source approval and the 31-day conflict horizon inside one transaction.
- Draft, publication and archive actions are audited.

## Verification completed

- the complete regression suite passes: 468 tests, 460 passed and 8 intentionally skipped;
- focused unit coverage passes for recurrence, timezones, DST handling, priorities, conflicts and maximum-capacity 31-day compilation;
- the tenant-scoped draft/version/preview/publication/archive lifecycle passes against a fresh migrated PostgreSQL database;
- the production build, static-integrity scan and performance-index checks pass;
- the 200-programme maximum compiles across the 31-day horizon in approximately 0.1 seconds on the verification machine.
