# Stage 17A — Subscriber Support Requests

Stage 17A begins the post-foundation product-improvement programme by connecting the subscriber Help Centre to the existing governed support operation. It introduces no new support database, entitlement, playback rule or external messaging provider.

## Subscriber experience

- Subscribers can open a bounded support request after reviewing the Help Centre.
- Six allow-listed categories cover player/audio, programming, content, account access, billing and general questions.
- Every accepted request receives an operational `SUP` reference and appears in request history.
- Status language is subscriber-friendly while preserving the existing operational states.
- Owners and managers can see their organisation's subscriber requests; other members can see only requests they created.

## Security and tenancy

- The active organisation is derived from the signed-in server session and is never accepted from request input.
- Listing always requires the same organisation ID as the active membership.
- Subscriber-created tickets are marked `SUBSCRIBER_SUPPORT` and cannot expose unrelated platform tickets.
- Subject and description are length-bounded, categories are allow-listed and subscribers cannot assign staff, set priority or change status.
- A user can create at most three subscriber requests within ten minutes.
- Creation writes an audit record without copying the support description into audit details.

## Operational integration

- Requests reuse the existing `SupportTicket` model and Super Admin compliance/support workflow.
- No migration is needed.
- Existing staff transitions, assignment and triage remain authoritative.
- The Help Centre and subscriber task navigation both link to the request page.

## Accessibility and privacy

- The page uses native labels, select, input and textarea controls with visible focus treatment.
- Success and error summaries use status and alert semantics.
- The route includes a skip link and responsive single-column layout.
- Subscribers are warned not to include passwords, enrolment codes, payment details or other secrets.

## Release verification

- Automated tests cover bounded input, role-sensitive visibility, safe labels, navigation, tenant scoping, rate limiting, audit creation and accessibility markers.
- Full regression, static-integrity and production-build gates remain required before publication.
