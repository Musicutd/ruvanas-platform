# Ruvanas Inside C5 request and rehabilitation boundaries

C5 adds facility-controlled radio requests, a reviewed rehabilitation audio catalogue, and staff-maintained contributor development records. C5.1 adds an authorised, private delivery path. It does not add prisoner messaging, a learning management system, an alternative scheduler, or an alternative proof-of-play engine.

## Request privacy and retention

- An external facility link is a random 192-bit code. The public form never returns internal facility IDs or confirms whether a recipient exists. Turning Family & Friends intake off blocks the link; turning it back on issues a new code.
- Public intake accepts only song requests, dedications, and short programme messages. An IP-level and per-code rate limit, duplicate suppression, server validation, size limits, consent and a honeypot apply. All submissions enter staff moderation, never the schedule.
- `CorrectionsRequest` retains original submitted text and the private recipient reference. Staff-approved on-air recipient/message fields are separate. `CorrectionsRequestDecision` preserves who reviewed each transition and the approved wording at that decision. Generic audit and notification records contain no private request text.
- Facility policy defaults to `DISABLED`. Tier 2+ and a current Corrections entitlement are required for intake. Owners and assigned facility managers control policy and decisions; viewers receive only restricted list summaries.
- No automatic destructive retention job is introduced. A later authority-specific retention policy must distinguish original evidence, moderated wording and proof-of-delivery, account for legal holds, and define access and deletion separately. Archive is a workflow state, not deletion.
- Approval alone never schedules a request. The dedicated staff-only C5.1 action creates existing `PlayoutIntent` rows for each enrolled private player, then transitions the request to `SCHEDULED` in the same transaction. The request remains scheduled if no valid completion arrives. `PLAYED` requires a signed `ProofOfPlayEvent` for that exact intent and media; it means system delivery only, not that anyone listened.

## Rehabilitation and development

- Rehabilitation metadata references existing organisation-owned, ready, approved Ruvanas media. Licensed catalogue masters are neither copied nor made downloadable. Content approval is separate from media approval, and the author cannot self-approve.
- Tier 1 may see only current, approved rehabilitation catalogue records; creating, reviewing and scheduling content starts at Tier 2. The private player serves only reviewed C5.1 insertions while the current entitlement remains active.
- The shared Corrections programme remains the grouping and scheduling authority. Content must be attached to that programme before its approval and latest Corrections Guard review. Scheduling never alters the submitted render or moderation record.
- Dashboard counts describe approved items, waiting review and upcoming expiry. Super Admin sees only aggregate counts. No behavioural, learning or recidivism outcome is inferred.
- Development milestones are staff decisions and are not qualifications. Session duration, submissions and programme status are derived from existing supervised Studio and Corrections records, but never automatically complete modules.

## C5.1 private scheduling and evidence

- The generic Corrections scheduling lock remains fail-closed. The only permitted C5.1 bridge is the dedicated staff scheduling action, which uses the established per-player `PlayoutIntent` primitive. It checks current tenant entitlement, facility staff authority, approved request/content, facility and zone ownership, active private Corrections channel, enrolled player, latest approved programme submission/render, policy version/fingerprint, and current media. Songs additionally recheck music rights, distributor, clean-content, facility blocks and territory both at scheduling and manifest time. Rehabilitation media must retain its own approval, approved media version and programme attachment.
- Private Corrections facilities do not inherit ordinary music, campaign, school or public-player fallback. The established player manifest signs the pinned intent/content, the existing protected media route serves it, and the established proof-of-play endpoint verifies player, zone, channel, intent, source token, window and completion position. No separate scheduler or proof engine is introduced. An expired, withdrawn or changed approval is omitted from future manifests.
- Request delivery reports expose the scheduled time, zone/channel and signed completion evidence, or a derived Needs Attention flag after the window closes without completion. Rehabilitation reports count approved content, scheduled player instances, actual completions and media-duration seconds; these are programme audio delivery measures, never course participation, completion or impact. No private sender, recipient reference or moderation note is sent to players.
- The schedule operation and proof processing are idempotent. Scheduling, delivery confirmation and player-reported failures/interruption are audited with IDs and safe metadata. A scheduled request may be archived later through the existing moderated transition. C5.1 intentionally has no request reschedule/cancel action; these require a separate guarded workflow and therefore cannot bypass the current immutable evidence. A missed event is derived for staff review, not asserted as proof.
- The new enum value is committed in its own migration before the following migration widens the existing intent and proof shape constraints; legacy campaign, school and ordinary music shapes retain their rules.

## Release boundary

Production Render Auto-Deploy stays off. Do not deploy these migrations or enable Corrections in production as part of C5. A later release still needs authority-specific retention decisions, accessibility and a supervised facility pilot.
