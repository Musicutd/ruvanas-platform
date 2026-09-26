# Ruvanas Inside C5 request and rehabilitation boundaries

C5 adds facility-controlled radio requests, a reviewed rehabilitation audio catalogue, and staff-maintained contributor development records. It does not add prisoner messaging, a learning management system, or an alternative playout engine. Corrections private delivery and scheduling remain locked by the existing shared guard.

## Request privacy and retention

- An external facility link is a random 192-bit code. The public form never returns internal facility IDs or confirms whether a recipient exists. Turning Family & Friends intake off blocks the link; turning it back on issues a new code.
- Public intake accepts only song requests, dedications, and short programme messages. An IP-level and per-code rate limit, duplicate suppression, server validation, size limits, consent and a honeypot apply. All submissions enter staff moderation, never the schedule.
- `CorrectionsRequest` retains original submitted text and the private recipient reference. Staff-approved on-air recipient/message fields are separate. `CorrectionsRequestDecision` preserves who reviewed each transition and the approved wording at that decision. Generic audit and notification records contain no private request text.
- Facility policy defaults to `DISABLED`. Tier 2+ and a current Corrections entitlement are required for intake. Owners and assigned facility managers control policy and decisions; viewers receive only restricted list summaries.
- No automatic destructive retention job is introduced. A later authority-specific retention policy must distinguish original evidence, moderated wording and proof-of-delivery, account for legal holds, and define access and deletion separately. Archive is a workflow state, not deletion.
- `SCHEDULED` and `PLAYED` are reserved states. C5 has no transition into them: the shared Corrections scheduling lock and future proof-backed private delivery must be integrated before those states may be used. Approval means only that an item is eligible for later staff scheduling, subject to current rights and policy.

## Rehabilitation and development

- Rehabilitation metadata references existing organisation-owned, ready, approved Ruvanas media. Licensed catalogue masters are neither copied nor made downloadable. Content approval is separate from media approval, and the author cannot self-approve.
- Tier 1 may see only current, approved rehabilitation catalogue records; creating and reviewing content starts at Tier 2. The private playback path remains locked for every tier pending the later delivery gate.
- The shared Corrections programme remains the grouping and future scheduling entity. C5 may attach approved, unexpired content only to a draft programme. It cannot publish that programme or bypass its subsequent Guard review.
- Dashboard counts describe approved items, waiting review and upcoming expiry. Super Admin sees only aggregate counts. No behavioural, learning or recidivism outcome is inferred.
- Development milestones are staff decisions and are not qualifications. Session duration, submissions and programme status are derived from existing supervised Studio and Corrections records, but never automatically complete modules.

## Release boundary

Production Render Auto-Deploy stays off. Do not deploy this migration or enable Corrections in production as part of C5. Before any later release, validate private-player authorization, proof-of-play attribution, scheduling integration, retention policy, accessibility, and a supervised facility pilot.
