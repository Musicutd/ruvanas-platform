# Stage 19.21 — Governed Online Radio advertising

## Outcome

Stage 19.21 generalises the existing Campaign and Retail Media systems for Online Radio. An authorised organisation can sell station- or channel-level inventory, link an approved audio campaign and order, set bounded commercial-break rules for each active channel, and review scheduled volume beside device-confirmed completed plays.

This is not a second advertising engine. Campaign creative, publication, scheduling, conflict handling and proof of play continue through the shared campaign pipeline. Commercial partners, inventory, order approval and creative approval continue through Retail Media. The new radio policy is a fail-closed delivery gate around those existing systems.

## Targeting and inventory

- Campaigns and Retail Media inventory accept `STATION` and `CHANNEL` targets in addition to the existing retail targets.
- A station target resolves through that station's existing active channels and channel-to-zone assignments. A channel target resolves only through that channel's assignments.
- Tenant ownership is checked whenever targets are created, and foreign keys ensure every target remains attached to a real station or channel. The channel policy additionally uses composite database keys to prove that its station, channel and organisation match.
- Existing retail and signage targets, approvals and delivery behaviour remain unchanged.

## Commercial-break policy

Each channel has at most one organisation-owned policy. Owners and managers can configure:

- even or priority pacing;
- maximum spots in one break;
- maximum seconds in one break;
- minimum minutes between break starts; and
- maximum advertising seconds in one hour.

Saving changes always returns the policy to draft and clears its prior approval. Activation creates a new revision and configuration hash. Pausing is immediate. A radio-targeted campaign is removed from playout when no active, approved policy exists; ordinary promotions continue unaffected.

## Booking and evidence boundary

A placement is ready only when the Retail Media order is approved or fulfilled, its inventory is active, the linked campaign is published, the matching audio creative is approved, campaign and inventory target the same station or channel, campaign dates stay inside the inventory window, and requested volume fits remaining inventory.

The workspace distinguishes estimated scheduled placements from completed proof-of-play events. Completed events demonstrate device-confirmed delivery. They do not prove a human listener, unique reach, response, conversion or commercial outcome. Public audience analytics remain a separate evidence source.

## Roles, audit and revocation

- Organisation owners and managers manage and approve break policies.
- Campaign and Retail Media role rules remain authoritative for creative and order actions.
- Draft saving, activation and pausing are recorded in the shared audit log with policy version, station, channel, revision and bounded configuration evidence.
- Policy pause, channel deactivation, station suspension, campaign archival or loss of approval blocks subsequent advertising delivery.

## Data and rollback

The migration extends the existing Campaign and Retail Media target enums and tables with station/channel relations. It adds `RadioAdvertisingPolicy` with composite organisation ownership, bounded database checks and an approval lifecycle.

Rollback is manual: pause active policies; export policy and audit evidence; remove the radio workspace and delivery gate; remove the policy table and new target columns/indexes; then remove the enum values only after all station/channel target records are removed. Do not delete shared campaigns, orders, proof events, stations, channels or audit history.

## Validation coverage

- Policy bounds, approval transitions and stable configuration hashes.
- Fail-closed behaviour without an active approved policy.
- Per-break spot and duration limits and per-hour advertising limits.
- Booking approval, creative, target, date and inventory-volume checks.
- Station/channel target expansion through the shared campaign pipeline.
- Existing Retail Radio, School Radio, campaigns, Retail Media and subscriber navigation regressions.

## Deferred

Stage 19.22 adds authority-specific rights and royalty reporting over immutable usage evidence. Pricing, billing settlement, audience claims, automated sales decisions and external ad exchanges are not introduced by Stage 19.21.
