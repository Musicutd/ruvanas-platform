# Phase 4A1 — Ruvanas Studio production-order intake

## Outcome

The first Stage 4 milestone introduces a tenant-scoped retail production brief and a controlled order-status workflow. It is additive: existing retail radio, campaigns, protected media, School Radio, player and proof-of-play behavior are unchanged.

## Scope delivered

- Subscriber workspace at `/dashboard/studio` for active organisations.
- Structured production brief covering promotion details, mandatory wording, language, voice/tone, target duration, music-bed preference, campaign dates, pronunciation notes, contact, funding source, priority and requested delivery date.
- Draft or immediate submission.
- Explicit workflow: `DRAFT` → `SUBMITTED` → `IN_PRODUCTION` → `AWAITING_CUSTOMER_APPROVAL` → `APPROVED` → `DELIVERED`.
- `CHANGES_REQUESTED` and `CANCELLED` branches with mandatory reasons.
- Append-only `ProductionOrderEvent` history plus the platform `AuditLog` for every material transition.
- Optimistic status update guard so two reviewers cannot silently overwrite one another.

## Access policy

- Every read and mutation resolves the signed-in user's active organisation server-side.
- Organisation content roles may create, save and submit briefs.
- Organisation owners/managers may approve, request changes or cancel.
- Ruvanas platform production roles may start production, request customer approval and mark approved work delivered, but they still require an explicit active organisation membership in this first increment.
- Cross-tenant order IDs return not found and never reveal order metadata.
- An inactive subscription cannot open Studio or use its APIs.

## Database migration

`20260828090000_production_order_intake`

The forward-only migration adds:

- `ProductionOrderStatus`, `ProductionOrderPriority`, `ProductionFundingType` and `ProductionOrderEventType` enums.
- `ProductionOrder` with tenant, creator, optional assignee, structured brief, workflow timestamps and operational indexes.
- `ProductionOrderEvent` with tenant, order, actor, status transition, note and chronological indexes.
- Database checks for target duration and paired/ordered campaign dates.

No existing table or column is removed or renamed. Rollback uses the previous application release; the additive tables remain dormant until a later corrective migration if required.

## API

- `GET /api/studio/orders`
- `POST /api/studio/orders`
- `PATCH /api/studio/orders/:orderId/status`

The status route accepts only the named domain actions and derives the next status server-side. Clients cannot write arbitrary status values.

## Verification

- Unit tests cover brief normalization, language/date/duration/contact validation, role boundaries, required revision/cancellation notes and final-state protection.
- Route-level integration coverage includes unauthenticated rejection, owner submission, platform-only production actions, cross-tenant denial, approval history and audit evidence.
- Required release gates: Prisma validation, clean-database migration deploy, unit tests, PostgreSQL integration suite, production build, GitHub CI and Render smoke test.

## Intentionally deferred to the next Stage 4 increments

- Supporting-file uploads and production attachments.
- Script versions, preview versions and revision assets.
- Production staff assignment and operational queue across organisations.
- Append-only production-credit ledger and provider-neutral paid add-on hooks.
- Linking a delivered Studio output to an approved `PromoVersion` and Campaign Builder.

