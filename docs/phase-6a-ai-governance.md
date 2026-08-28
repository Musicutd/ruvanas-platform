# Stage 6A - governed AI draft foundation

Stage 6A introduces a provider-neutral assistant workflow without allowing generated content to bypass normal Ruvanas controls.

## Delivered

- Retail promo, scheduling and analytics draft types.
- School script, show-plan and pronunciation-support draft types.
- Explicit data classification on every request.
- Provider and provenance metadata on every generated artifact.
- Human approval or rejection with an editable final artifact and audit evidence.
- No automatic campaign publication, schedule changes or school-content release.
- A local Ruvanas template provider that sends no content to a third party.
- Policy guards for future third-party providers: terms must be approved, and private student data is blocked.

## Operational boundary

An `APPROVED` AI job is an internal, human-reviewed artifact only. It is not a published campaign, active schedule, approved school episode or playable media asset. Those domains retain their existing validation and publication routes.

The initial local provider is deliberately deterministic so the governance workflow can be exercised without external credentials or data transfer. Later Stage 6 work can add approved providers behind the same request, provenance and review boundary.

## Next Stage 6 slices

- Approved provider adapters and optional preview-only TTS.
- AI music-ingestion provenance and rights-review evidence.
- Public API v1 resources, rate limits and idempotency.
- Signed outgoing webhooks with retries and delivery visibility.
- POS, inventory or footfall summary adapter as the first end-to-end integration.
- Target-school-driven identity, roster and LMS evaluation.

