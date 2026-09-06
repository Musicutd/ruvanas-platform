# Stage 19.20 — Rights-controlled radio syndication

## Outcome

Stage 19.20 adds a governed syndication workspace for stations that already have an active Stage 19.19 network membership. A source station can offer a published recorded programme or its configured live output; a receiving station can request a bounded use; and the source organisation must separately approve that exact receiving station before delivery can be activated.

Network membership remains only a directory and trust boundary. It does not grant audio access. Every syndicated delivery depends on both station memberships, the network, the source offer, the recipient agreement, the source media or live output, both stations and the rights window remaining active at request time.

## Rights and authority

- Organisation `OWNER` and `MANAGER` members control offers and requests. Editors and viewers cannot enter cross-organisation rights agreements.
- Every offer records a rights holder, evidence reference, legal basis, permitted territories, start time, optional end time and immutable policy version.
- Receiving territories must be a subset of the source offer. Requested dates must stay within the offer window.
- `WORLDWIDE` is explicit and cannot be mixed with country codes; otherwise ISO-style two-letter country codes are required.
- A recipient requests one offer for one receiving station. An optional local channel records the intended destination without changing its schedule automatically.
- Source approval, recipient activation, pause, withdrawal, decline, cancellation and revocation are separate audited decisions.
- Recorded audio and live relays use protected server routes. Storage keys, provider URLs, credentials, audience data, subscription data and internal source configuration are never included in cross-tenant workspace responses.

## Lifecycle and immediate revocation

Offers begin as `DRAFT`, may become `AVAILABLE`, may be paused and resumed, and may be permanently withdrawn. Requests begin as `PENDING`; the source may approve or decline them, the recipient may cancel while pending, and the source may revoke an approved agreement.

Delivery fails closed whenever any dependency stops being valid: the network is paused or archived; either membership is revoked; the offer is paused or withdrawn; the agreement is not approved; either station is inactive; the source programme, media or channel is unavailable; the rights window has not started or has expired; or the contracted territory is not present. This provides revocation propagation without copying protected audio into the recipient tenant.

## Delivery and evidence

Recorded programmes reuse the existing range-aware protected podcast delivery core with `private, no-store` caching. Live programmes reuse the provider-neutral protected relay and its public-endpoint validation. Successful deliveries append audit evidence containing the agreement, offer, receiving station, territory, delivery type and bounded transport facts. The evidence does not contain secrets or source URLs.

Stage 19.20 intentionally activates a protected recipient feed rather than silently editing a channel schedule. This keeps programme placement an explicit local programming decision and avoids an external station changing another tenant's playout.

## Data and rollback

The migration adds `RadioSyndicationOffer`, `RadioSyndicationAgreement` and three lifecycle enums. Composite foreign keys prove that source and target stations and channels belong to the declared organisations. Both offer sources are mutually exclusive through a database check constraint. Records use restrictive deletion because rights decisions and delivery evidence must be retained or exported before removal.

Rollback is manual: disable the workspace and delivery routes, withdraw active offers, export agreements and matching audit records, remove the agreement table, remove the offer table and then remove the three enums. Never delete source programmes, stations, organisations or shared audit history as part of rollback.

## Validation coverage

- Input tests cover source exclusivity, text bounds, ISO territory normalisation, subset rules and bounded time windows.
- State-machine tests cover source and recipient authority and reject illegal transitions.
- Delivery tests exercise every fail-closed dependency for recorded and live sources.
- Redaction tests prove source storage, provider, credential, listener and subscription internals never enter shared summaries.
- Route-security checks cover exact tenant ownership, active network membership, independent source approval, protected delivery, no-store caching and delivery evidence.
- Migration checks cover composite ownership, restrictive deletion and source-kind constraints.
- A 10,000-offer fleet summary provides a linear performance regression guard.

## Deferred

Stage 19.21 will generalise advertising and inventory. Automated insertion of syndicated programmes into the unified scheduler, commercial settlement and royalty reports remain later, separately governed stages; Stage 19.20 provides the agreements and immutable evidence they require.
