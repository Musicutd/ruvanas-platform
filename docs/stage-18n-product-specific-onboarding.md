# Stage 18N — Product-specific onboarding and launch checklists

## Outcome

Retail Radio, School Radio and Online Radio now have separate evidence-led launch journeys inside their own dashboards. Each workspace explains the next useful action, shows overall progress and identifies whether a step belongs to the subscriber, Ruvanas review or live system evidence.

## Retail Radio

The launch path covers an active retail location, approved music and a published schedule, an enrolled secure player and a current live shop session. Existing location, programming, player and listener-lease records remain authoritative.

## School Radio

The launch path covers the private school workspace, active staff supervision, approved safeguarding readiness, an active programme, a staff-approved episode and controlled live playback. A safeguarding pack waiting for approval is clearly shown as a Ruvanas review task; the subscriber interface never implies that a school can self-approve it.

## Online Radio

The launch path covers an active station, a configured private streaming connection with a public stream URL, active music and a published schedule, and a current listening session.

## Super Admin visibility

The organisation directory shows compact Retail, School and Online readiness percentages. Progress is derived from the same tenant-owned records used by the subscriber dashboards. Products outside an organisation's current effective entitlements are labelled as not included.

## Boundaries

- No new mutable checklist, database table or migration is introduced.
- Existing route permissions, product entitlements and organisation isolation remain authoritative.
- Viewer accounts receive status-oriented guidance and are not told they can perform owner or manager tasks.
- Complimentary access follows the selected tier and remains active until a Ruvanas Super Admin disables it.
- Publication must target only the paid `ruvanas-platform` service; the free staging service remains suspended.

## Verification

Automated tests cover ordered progress, real readiness dependencies, safeguarding review ownership, viewer wording, accessible progress semantics, responsive presentation and Super Admin visibility. Full regression, static integrity and production compilation must pass before publication.
