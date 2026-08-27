# Phase 2: Versioned music schedule engine

This milestone turns organisation-owned Music Modes into deterministic weekly programming without creating a second scheduler for School Radio.

## Behaviour

- A schedule targets exactly one Location or one Zone.
- Its timezone is copied from the target Location and all slots remain in local wall-clock time across daylight-saving changes.
- Slots support overnight windows and cannot overlap, including after midnight.
- A published version replaces the previously published version for the same target; older versions remain archived for auditability.
- A Zone slot overrides a Location slot while both match. Outside a matching Zone slot, the resolver falls back to the Location schedule.
- Closed locations resolve no music, using the existing weekly opening hours and date exceptions.
- Only active Music Modes may be published. Draft schedules may reference draft modes while they are being prepared.
- Resolution is deterministic: target specificity, slot priority, schedule version, schedule ID, then slot ID.

## Safety

Database checks enforce one target, valid weekdays, local-minute ranges, non-empty windows, priorities, effective date order, and one published version per target. The server also verifies organisation ownership and writes audit events for activation, draft creation, and publication.

## Next milestone

Add a compiled player manifest and cacheable schedule snapshot so enrolled players can fetch the resolved mode and track rotation safely. School Radio broadcast slots will later feed the same manifest compiler after approval and safeguarding checks.
