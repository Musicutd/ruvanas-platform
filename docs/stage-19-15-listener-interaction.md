# Stage 19.15 — Listener Interaction

## Outcome

Stage 19.15 adds an optional, moderated song-request journey to the public Ruvanas player. A station owner enables the feature, listeners submit a bounded artist/title request during an active listening session, and the station team reviews it in a tenant-scoped queue.

Listener requests are editorial suggestions only. Approval does not add a track to a Music Mode, Radio Clock, schedule, playout intent or live queue. The station remains responsible for catalogue availability, rights clearance and the final programming decision.

## Controls

- The feature defaults to off and is configured per station.
- Submission requires an active anonymous Stage 19.14 listener lease.
- Only privacy-safe session hashes are stored; raw listener session IDs and network addresses are not stored with requests.
- Artist, title, optional message and station instructions have strict size and content limits.
- A persistent database rate-limit bucket caps submissions per session/network boundary.
- A 30-minute HMAC deduplication window rejects repeated requests without exposing the original values.
- Owner and manager roles can block or unblock an abusive anonymous session; content editors can perform normal editorial moderation.
- Status changes use optimistic updates, create tenant-scoped audit evidence and follow the explicit `PENDING → APPROVED/REJECTED → PLAYED/ARCHIVED` lifecycle.
- Subscriber notifications reuse the shared Stage 11D job and notification pipeline.

## Surfaces

- Public full-page player: optional **Request a song** form.
- Station public-player settings: enable requests and define listener instructions.
- Station listener-request workspace: filter, approve, reject, mark played, archive, block and unblock.
- Notification centre: new listener-request event category.

## Validation matrix

- Unit: normalization, HMAC deduplication, lifecycle transitions and safe response projection.
- Integration/static: active lease enforcement, tenant access, rate limiting, moderation audit, notifications and absence of automatic playout writes.
- Regression: public player, notification centre, Retail Radio and School Radio suites.
- Performance: 20,000 bounded normalization operations plus indexed station/status/session database paths.

## Rollback

Disable listener requests on each station first. Application rollback is safe because the new station fields default to false and no existing playout path depends on the new tables. Preserve request and moderation records for audit/abuse evidence; remove schema objects only through a separately reviewed data-retention migration.
