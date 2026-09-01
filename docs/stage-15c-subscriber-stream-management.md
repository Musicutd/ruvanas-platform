# Stage 15C — Subscriber stream-session management

## Purpose

Stage 15C gives client organisations practical control of the active shop-stream quota introduced in Stage 15B. An authorised subscriber can identify the enrolled player consuming each slot and stop a stale or unwanted session without waiting for its lease to expire.

## Client controls

- The client dashboard links to an Active shop streams page.
- Each live slot identifies the enrolled player, location, zone, and last confirmation time.
- Organisation owners and managers can stop a session; content editors and viewers have read-only visibility.
- Every stop is tenant-scoped and recorded in the organisation audit trail.
- The active-session JSON endpoint exposes the same tenant-safe summary for future native clients and support tooling.

## Player safety

- A stopped browser is refused with a clear Player session stopped state.
- Its protected media token becomes invalid immediately.
- The revoked browser-instance fingerprint remains blocked for the 90-second safety window and is then removed automatically.
- A revoked lease no longer counts against the subscribed stream allowance, so a legitimate replacement player can start immediately.
- Permanent player disablement and retirement remain separate Ruvanas operations controls.
