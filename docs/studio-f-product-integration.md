# Studio F — Export and product integration

Studio F returns one approved, immutable Studio master into the correct Ruvanas product workflow. It does not copy the audio, publish publicly, alter a subscription or create a billing event.

## User journey

After a final multitrack render has completed, passed audio quality checks and been approved by an owner or manager, Studio shows only the destinations enabled for the organisation:

- **Retail promotion** records the handoff and opens Promotions with the approved version selected.
- **School episode** records the handoff and submits the approved version into the Studio project's linked episode for the existing staff-review workflow.
- **Online podcast** records the handoff and opens Podcasts with the approved master selected for a private draft.

Unavailable products stay visible with a plain-language reason. Repeating the same action reuses the existing handoff instead of duplicating a submission or record.

## Governance and data model

`StudioProductHandoff` is an append-only evidence record linking the organisation, Studio project, exact render, approved promo version, protected media asset, optional School episode, destination, safe workflow path and creating user. A deterministic destination key makes the operation idempotent.

The server independently verifies all of the following before creating a handoff:

- the user is an authorised member with an active School Radio product;
- the render, project, media asset and target all belong to the active organisation;
- the render succeeded and its protected media is ready;
- the exact output version is approved and its audio QC passed;
- the destination product is enabled by current server-side entitlements;
- a School destination has an organisation-owned episode linked to the Studio project.

Every new handoff writes an audit event. The stored evidence explicitly records that the handoff caused no billing mutation and no public publication.

## Product boundaries

Retail and Online destinations open their existing governed editors with the exact approved output preselected. School creates an ordinary `SchoolSubmission`, supersedes only a previous submitted revision and moves the episode into its existing staff review. Public podcast publication, campaign scheduling, player scheduling, voice tracking and distribution remain separate explicit actions in their established workflows.

## Rollout and rollback

The additive migration creates one enum and one handoff table with restrictive references to immutable production records. Deploy the schema before serving the new Studio UI. Rollback first removes the UI and API; retain handoff and audit evidence under the platform retention policy. Drop the table and enum only after confirming no Studio F release remains active.

## Validation

- Unit tests cover entitlement filtering, linked-episode requirements, stable destination keys, safe workflow paths and approved-render gates.
- Source-integrity tests cover organisation scoping, server-side entitlement checks, audit evidence, no-billing/no-publication guarantees and podcast preselection.
- Full regression tests, static integrity checks, Prisma generation and the production build remain release gates.
