# Stage 19.19 — Multi-Station Network

## Outcome

Stage 19.19 introduces a governed network directory for independently owned Online Radio stations. A subscriber organisation can create a named network, add its own active stations, invite an external active station by its exact public slug, and review the state of every agreement in one workspace.

This stage establishes membership only. It does not grant access to another station's audio, programming, audience analytics, listener capacity, credentials, provider account, subscription or operational controls. Syndication remains Stage 19.20 and requires a separate rights-aware agreement.

## Authority boundary

- The network has one explicit operator organisation.
- Only an operator organisation `OWNER` can create or archive a network.
- Operator `OWNER` and `MANAGER` members can invite or remove stations and pause or resume invitations.
- A cross-organisation invitation remains `INVITED` until the invited station organisation's `OWNER` accepts it.
- The invited station organisation's `OWNER` can decline the invitation or leave an active network.
- A station owned by the network operator can be activated immediately because the same organisation controls both sides.
- `CONTENT_EDITOR`, `VIEWER` and `STUDENT` memberships cannot bind an organisation to a network.
- Every creation, update, invitation, acceptance, decline, departure and removal is written to the existing audit ledger.

## Agreement lifecycle

`INVITED` may become `ACTIVE` or `DECLINED` through a station-owner decision. An `INVITED` or `ACTIVE` agreement may become `REVOKED` when the operator removes it, and an `ACTIVE` agreement becomes `REVOKED` when its station owner leaves. Declined or revoked stations immediately lose participant visibility; the network operator retains the agreement record and the shared audit ledger retains the decision evidence. Either state can be invited again, creating a fresh decision window.

## Subscriber experience

The Online Radio dashboard links to `/dashboard/radio/networks`. The workspace shows operator and participating networks, active and pending counts, safe station directory details, owner decision controls, and plain-language reminders about the boundary between membership and content sharing.

External stations are addressed by exact slug rather than through a platform-wide station browser. This avoids exposing a tenant directory while still permitting two organisations that intend to collaborate to establish a controlled invitation.

## Data and migration

The migration adds `StationNetwork`, `StationNetworkAgreement`, two bounded status enums and an optional `stationNetworkId` relation on `AuditLog`. A composite foreign key from agreement `(stationId, stationOrganisationId)` to station `(id, organisationId)` prevents an agreement from claiming the wrong owner organisation.

Rollback is deliberately manual because agreement and audit evidence must be exported before removal. Disable the subscriber route, export `StationNetworkAgreement` and related `AuditLog` rows, drop the new audit foreign key/index/column, drop agreement then network tables, and finally drop the two enums. Do not silently cascade-delete participating stations or organisations.

## Validation coverage

- Unit checks cover bounded metadata, operator roles, station-owner approval and legal state transitions.
- Route-security checks assert exact-station lookup, active-station eligibility, tenant-safe query boundaries, approval authority and audit evidence.
- Redaction checks prove summaries omit provider, streaming, credential, analytics and subscription internals.
- Migration checks cover uniqueness, composite station ownership and restrictive deletion.
- Fleet performance checks exercise 10,000 agreement records.
- Shared full-suite, integration, performance, static and production-build gates remain required before publication.

## Deferred to Stage 19.20

Recorded programmes, live relays, schedules, media copies, rights windows, geographic restrictions, play evidence, revocation propagation and any syndication-specific commercial terms are intentionally absent from Stage 19.19.
