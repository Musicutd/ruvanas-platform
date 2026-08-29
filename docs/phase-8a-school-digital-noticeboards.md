# Stage 8A — School Digital Noticeboards

Stage 8A adds the first guarded School Radio extension after the core roadmap: approved school announcements can be scheduled on enrolled Ruvanas digital-signage displays.

## Product boundary

- A notice can only be created from a School Announcement whose staff review status is `APPROVED`.
- Only organisation owners and managers can schedule or cancel a notice.
- Staff with School Radio content access can view the notice history.
- Every notice targets exactly one school location or one zone, and tenant ownership is checked again at delivery time.
- Schedules have a positive, maximum 31-day window, a bounded display duration, and a bounded priority.
- No student account, public feed, student profile, comments, reactions, or direct student publishing is introduced.
- The display payload contains only the approved title and summary. It does not expose audio identifiers, storage keys, staff email addresses, or internal review notes.

## Delivery

The existing enrolled-display cookie and entitlement checks remain the trust boundary. Eligible notices are included in the signed, private, no-store signage manifest only when both School Radio and Digital Signage are enabled for the same organisation.

- With no active visual playlist, the display becomes a full-screen school noticeboard.
- With an active playlist, notices rotate in a high-contrast supervised overlay.
- An active operational takeover suppresses normal school notices so they cannot obscure urgent display content.
- Notices remain available under the existing verified offline-manifest grace period.
- Important, information, and celebration presentations are supported.

## Operations and audit

Scheduling records `SCHOOL_NOTICEBOARD_SCHEDULED`; removal records `SCHOOL_NOTICEBOARD_CANCELLED`. Cancellation requires a reason. Database constraints enforce target, time, priority, and duration limits even if an API guard is bypassed.

## Verification

Unit coverage validates schedule boundaries, approval and tenant isolation, target matching, deterministic priority, standalone noticeboard delivery, and playlist overlays. Route-security coverage verifies that noticeboard management remains authenticated.
