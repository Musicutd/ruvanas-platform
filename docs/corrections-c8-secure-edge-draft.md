# C8 Secure Edge — architecture and release record (Draft)

This is a non-production implementation record. C8 is **not** approved for
facility use until its offline, reconnect, rights, cross-facility, player and
regression gates have passed. Production Auto-Deploy must remain off.

## Existing-core audit and reuse decisions (C8A, before new abstractions)

| Existing core | C8 decision |
| --- | --- |
| `Organisation`, `Location`, `CorrectionsFacility`, `Zone`, `Player` | An Edge is one organisation and **one existing facility**. It must not create a second tenant, zone or player registry. |
| Player enrolment/session and listener leases | Reuse the random-secret/HMAC-hash pattern, not a user password or browser cookie. An Edge is a distinct machine identity; a generic player session or generic service account is too broad and lacks a facility constraint. |
| `resolvePlayerProgramming`, C7 network choice, C6 overrides, `PlayoutIntent` | Cloud remains the only issuer of approved playback decisions. C8 must use version-pinned outcomes and the C7/C6 ordering; no independent approval or scheduler. |
| Player manifest/protected media/proof | Reuse the explicit intent, protected media and signed proof concepts. The existing five-minute browser manifest and thirty-day online proof endpoint cannot simply be relabelled as an offline authorisation or offline proof protocol. |
| `MediaAsset`, R2 protected object storage, catalogue, rights | Keep cloud storage private and recheck entitlement, rights and facility policy before each authorised Edge sync. No supplier credentials or arbitrary `mediaAssetId` access on Edge. |
| Corrections Guard and network source policy | Source approval, exact render, territory and facility restrictions remain cloud authority. Offline execution may only consume a signed prior snapshot within its validity. |
| `ApiKey` / `ServiceAccount` | Reuse the tested key-hash design. Their generic scopes do not encode an immutable facility, so C8 needs a separate facility-bound node record and credential lifecycle. |
| Audit, notifications and operational health | Reuse cloud `AuditLog` and notification conventions. Edge telemetry must be narrow and must not claim human listening or an offline node is healthy. |
| Protected-media recovery / workers | Reuse recovery principles and existing storage API. C8 must not add unrestricted host/OS commands or a second media archive. |

## Trust and threat boundaries

Cloud owns entitlement, policy, rights, approvals, revocation and distribution.
An Edge owns only a bounded signed cache, encrypted local media, local player
service and queued delivery evidence. Ed25519 signatures give the Edge a
verifiable cloud manifest without giving it a cloud signing key. Each node
credential is scoped by database identity to one facility. A stolen node key
can impersonate that node until revocation; rotation and audit limit exposure.
An offline Edge cannot learn a newly issued revocation, so its maximum offline
validity is the explicit bounded residual risk, never an indefinite licence.

Specific tests must address stolen disks/copied cache, LAN probing, manifest
replay, forged proof, rollback of local wall time, expired/withdrawn rights,
cross-facility credential reuse, corrupted media and stale schedules. Local
service must fail closed if its signing trust anchor is absent. A compromised
Edge host remains a residual risk; encryption at rest is not DRM and cannot
make a hostile host incapable of accessing audio it is playing.

## Planned C8 checkpoints

- **C8A:** facility-bound machine identity/enrolment, signature contract,
  negative tests and audit.
- **C8B:** cloud-authorised exact media, encrypted staged cache and atomic
  activation; bounded validity and eviction.
- **C8C:** authenticated LAN player runtime sharing C7/C6 precedence.
- **C8D:** append-only offline proof, reconnect reconciliation, deduplication.
- **C8E:** expiry, revocation, corruption, rotation and decommission.
- **C8F:** health, staff/Super Admin visibility and isolated live offline test.

No phase is a production release by itself. A Draft PR must remain unmerged
until every required C8 gate is demonstrated with isolated synthetic media.

## C8A checkpoint evidence

- One-use 15-minute enrolment tokens are HMAC-hashed, cleared atomically on
  claim, and only disclosed in the initial Super Admin response. An Edge
  receives a separate 256-bit machine credential; only its keyed hash is
  stored. Rotation invalidates the previous credential immediately, and
  revocation removes credentials and enrolment state. There is no bearer
  credential in the read-only fleet response.
- Node actions require Super Admin, an active Corrections facility owned by
  the selected organisation, and active Tier 4/5 Inside entitlement. Every
  machine request rechecks node status, facility ownership and entitlement.
  Support staff, subscribers and cross-facility IDs cannot create nodes.
- The manifest contract uses canonical JSON and Ed25519, with domain
  separation, sequence, fixed organisation/facility/node scope and bounded
  expiry. A local runtime must pin the cloud public key out of band. It must
  never accept a key supplied in the same untrusted manifest. The private
  signing key is not stored in the database or provisioned to an Edge.
- A fresh isolated PostgreSQL database applied all 128 migrations, including
  C8A. Prisma validation/generation, the production-style Next build, static
  checks, signature negative tests and a route-level isolated enrolment /
  replay / Tier 3 / cross-tenant / rotation / revoke test passed. The existing
  repository has unrelated baseline schema-diff noise; no C8-specific drift
  appeared after the C8A migration.

**Not yet complete:** the cloud does not yet issue playable manifests, media
or an Edge proof path. No Edge runtime is connected to a player. The heartbeat
is a bounded machine report, not evidence of successful playback or sync.
These omissions keep C8A non-operational by design. No release gate for
offline playback is claimed by this checkpoint.
