# Stage 16B — Guided Core Workflows

Stage 16B applies the Stage 16A usability foundation to four frequent operating journeys: station setup, music scheduling, shop-player activation and subscriber media upload. It adds guidance and presentation only; existing APIs, validation, permissions, subscriptions and evidence remain authoritative.

## Shared workflow pattern

- Every priority journey shows a compact ordered progress line with complete, current and upcoming steps.
- The progress component works in the dark subscriber interface and the light administration interface, and changes to a vertical layout on narrow screens.
- Contextual notes explain what a user needs before beginning and identify the safe choice when a workflow can publish or replace live configuration.
- Errors use a bounded, plain-language presentation with an accessible alert role. Success results use a consistent live announcement.

## Station setup

- Station creation is framed as the first of three steps: station details, private streaming connection, and final review.
- The streaming connection page continues the same progress sequence and explains where the required details are normally found.
- Password handling is described without revealing or redisplaying credentials.

## Music scheduling

- Schedule creation is divided into customer, playback area, weekly programme, and review/save steps.
- Progress responds to the selected organisation, target and valid slot basics.
- The draft-first recommendation makes the non-live option clear before publication.
- Slot controls now use a responsive grid instead of a fixed desktop-only row.

## Shop-player activation

- The existing readiness evidence now drives one visible first-shop journey: prepare, enrol, connect and confirm playback.
- Progress is based on tenant-scoped player evidence and never claims that physical speakers or audience listening have been verified.

## Media upload

- The former utility-class-only page is replaced with a complete responsive Ruvanas interface.
- File selection, metadata review and secure upload are presented as three steps.
- File guidance, disabled states, review status, upload evidence and a clear “upload another” path are provided.
- File signatures and the server-side validation pipeline remain unchanged.

## Security and data boundaries

- No database migration or customer-data rewrite.
- No new credentials, fingerprints, tracking or audience claims.
- Existing server-side permissions, file validation, tenant checks and publish controls remain unchanged.
- The free staging service remains outside this work.

## Next usability increment

Stage 16C should standardise page headers, empty states, confirmations and help text across the remaining subscriber and administration screens, followed by accessibility and keyboard testing of complete user journeys.
