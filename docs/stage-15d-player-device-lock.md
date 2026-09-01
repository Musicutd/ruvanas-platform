# Stage 15D — Enrolled player device lock

## Purpose

Stage 15D prevents one enrolled shop player from being duplicated across browsers or devices. A subscriber plan may allow several simultaneous shops, but every active shop must use its own enrolled player identity.

## Behaviour

- Each enrolled player holds at most one active browser-device lease.
- Reopening the same browser renews its existing lease without consuming another plan slot.
- A copied player session on another browser is refused even when the subscription has spare stream capacity.
- Distinct enrolled players can run simultaneously up to the organisation's subscribed stream allowance.
- An organisation owner or manager can stop the current session from **Active shop streams**, allowing a legitimate replacement device to take over immediately.
- Abandoned device locks expire automatically with the existing 90-second listener lease.

## Safety boundary

The lock uses the existing private, hashed browser-instance fingerprint. Raw device identifiers, IP addresses, and personal listener profiles are not added. Subscription capacity remains organisation-scoped and protected by the existing serializable transaction boundary.
