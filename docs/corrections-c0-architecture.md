# Ruvanas Inside — C0 architecture and threat model

## Scope and decision

Ruvanas Inside is product family `CORRECTIONS`, not a second radio platform. C1 adds commercial identity, a server-resolved capability, a dedicated rights-use identifier and an access-gated foundation page. It does **not** create a playable Corrections channel or a public listener page. C2–C9 remain separate release gates.

## Existing core to reuse

| Concern | Existing authority | Corrections extension, later stage |
| --- | --- | --- |
| Tenant, identity, roles, billing | `Organisation`, `OrganisationMember`, `Subscription`, `Plan`, session/auth and billing reconciliation | Facility-scoped duties and contributor identity; never a parallel user store |
| Physical hierarchy and devices | `Location`, `Zone`, `Channel`, `Player`, leases, health and proof-of-play | Facility terminology, zone policy and explicit device assignment |
| Audio programming | Music catalogue, rights use, Media Library, playlists, AutoDJ, schedules | Corrections Guard must filter before selection, scheduling and playback |
| Production | Ruvanas Studio, Studio Pro, product handoff | Supervised contributor mode and approved-only handoff |
| Editorial controls | School safeguarding and Health request patterns | Corrections-specific approval roles; do not reuse student/patient data models |
| Operations | Notifications, audit logs, analytics, reports, integrations | Facility-scope evidence, private reporting and emergency event audit |

## Trust boundaries and threats

1. **Account → organisation:** Every route and query must derive the active organisation from the authenticated membership, not a client-supplied ID. `requireSubscriberProduct("CORRECTIONS")` guards the C1 dashboard; future APIs must independently enforce the same rule.
2. **Organisation → facility → zone:** A facility must be owned by the organisation, and a zone by that facility. A user assigned to one facility must not read or operate another. C1 creates no facility resources or facility-scoped permissions; these are mandatory in C2 before operational access.
3. **Role → approval authority:** Existing owner/manager/viewer roles are not sufficient for supervised contributors. Contributors must not publish, schedule, distribute or download licensed audio. Define explicit time-bounded contributor sessions and approval separation in C3–C4; do not treat existing school students as Corrections contributors.
4. **Music → playout:** `CORRECTIONS_RADIO` is a distinct rights use. A matching rights use alone is insufficient: territory, tier, facility policy, clean-content rules and explicit approval must all pass before any Corrections track is playable. C1 intentionally creates no Corrections channel/playlist/player path, so rights-labelled content cannot go live through this pillar yet.
5. **Private delivery → public internet:** Existing Online Radio player, public URL, directory and rebroadcast controls are not safe defaults for Corrections. Private listener authentication, signed delivery, revocation and no public indexing are prerequisites for C2/C8. C1 exposes no Corrections Listen link.
6. **Facility operations → emergency:** Priority and emergency interruption must be audited and return to a verified safe source. No browser-only override or unverified fallback is acceptable. Deferred to C6.
7. **Provider → catalogue:** Supplier ingestion remains Super Admin-controlled. Licensed Music Catalogue level is commercial eligibility, not playback permission or download permission. No supplier name is baked into subscriber product identity.
8. **Sensitive data:** Do not collect prisoner profiles, case records, health records or family identity beyond a future minimal moderated request workflow. Audit records should identify staff action and media decision, not unnecessary personal details. Retention, access and deletion rules need C2/C5 design.
9. **Cloud → Secure Edge:** Offline edge nodes cannot self-authorise new rights or policy. Require signed policy/media manifests, expiry, revocation, local audit queue and replay protection in C8 before any offline deployment.

## C1 migration and compatibility

Two additive migrations are sequenced so PostgreSQL commits new enum values before new plan rows use them. Existing plan capability defaults to `false`; existing subscription overrides and complimentary snapshots remain null/false. No production account is silently moved to Corrections. The five new plans are inserted by stable code without altering existing plans. Their numerical station, storage and listener allowances are conservative commercial placeholders consistent with existing `Plan` fields; facility and zone limits are **not represented or enforced** in C1 and must be modelled in C2 before an operational launch.

## Release boundary

The C1 registration and pricing surfaces identify the new plans, but the product dashboard states that playback is not enabled. Do not activate Corrections channels, generic AutoDJ, public listeners, Studio handoff or edge devices until the corresponding guarded stages are implemented and tested. Super Admin streaming setup remains separate from subscriber product access.
