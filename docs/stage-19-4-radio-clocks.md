# Stage 19.4 — Radio Clocks

## Outcome

Stage 19.4 adds organisation-owned, reusable 60-minute Radio Clocks to the subscriber programming workspace. A clock is a governed template, not a parallel scheduler: Stage 19.5 will assign published clocks to channel schedules, while the existing schedule, Show Builder, AutoDJ and synchronized playout primitives remain authoritative.

## Clock structure

Each clock contains an ordered sequence of up to 100 items. The supported source contracts are:

- active Music Modes, including Smart Playlist-backed modes;
- individual music tracks from the Ruvanas catalogue or the organisation library;
- approved, quality-checked jingles and promos;
- current approved Show Builder rundowns; and
- zero-duration timing markers.

Every playable item has a positive planned duration. The service derives immutable offsets from the ordered sequence. `CROSSFADE` and `DUCK_VOICE` transitions reuse the Show Builder transition vocabulary and subtract their controlled overlap from the hour. `CLEAN` and `HARD_START` never carry an overlap value.

Drafts may be shorter than one hour so editors can work progressively. A clock can be published only when its derived timeline is exactly 3,600 seconds. Database checks also reject negative positions, offsets or durations, invalid transition lengths, and item/source mismatches.

## Governance and tenancy

- Owners, managers and content editors can create and revise drafts.
- Only owners and managers can publish or archive a clock.
- Organisation identity always comes from the authenticated active membership; request bodies cannot select another tenant.
- Source bindings are checked against the organisation or its permitted catalogue view.
- Publication re-checks source readiness and Online Radio rights, failing closed if a source is no longer playable.
- Published content is versioned. Editing increments the draft version without changing the approved published version until an explicit republish.
- Draft creation, revision, publication and archive actions create audit records.

## Subscriber experience

The Radio Programming page now provides:

- saved-clock status and unpublished-change indicators;
- an exact-hour timing meter;
- ordered item and source controls;
- a one-click final-item fit helper;
- transition and overlap controls;
- a one-hour timeline preview with calculated offsets; and
- controlled publication and archive actions.

## Reuse and next dependency

`RadioClock` and `RadioClockItem` are shared Online Radio primitives. They do not duplicate School Radio rundowns, Music Schedules or the live player clock. Week expansion is deterministic and bounded to 168 hourly occurrences. Stage 19.5 can therefore add channel targets and typed programme sources without changing the clock's authoring contract.

## Verification target

- pure timing, validation, transition, role and 168-hour expansion tests;
- schema and migration checks;
- route-security and tenant-bound source checks;
- real database/API lifecycle: create, preview, publish, revise, publication rejection, republish and archive;
- full Retail Radio and School Radio regression suite;
- production build and static/performance checks.
