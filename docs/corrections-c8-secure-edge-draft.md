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

## C8B–C8D implementation evidence (still Draft)

- The cloud issues a 24-hour Ed25519-signed, sequenced, node/facility-bound
  snapshot of currently eligible C7 network windows, C6 overrides, zones,
  players, content checksums, policy versions and expiry. Its protected media
  endpoint first checks current manifest membership, then revalidates the
  approved source, rights use, territory, facility and entitlement. It cannot
  serve an arbitrary asset or another facility's content.
- Edge media is AES-256-GCM encrypted under a separately provisioned cache
  key. Opaque filenames, 0700 directories, 0600 files, checksums, quarantine,
  staged download and atomic manifest-pointer activation prevent ordinary
  filesystem browsing, partial activation and corrupt playback. Delta sync
  reuses exact content. Withdrawal evicts content after the next authorised
  sync. A disconnected Edge can retain previously signed content only until
  its manifest expires; expiry causes controlled silence, not public fallback.
- A private LAN player service requires a cloud-signed node/facility/zone/
  player grant, and TLS off loopback. Only the player's *current* resolved
  content has a temporary opaque route. C7 ranking and C6 override choice
  come from the existing pure policy modules; the Edge does not approve or
  schedule anything. An online credential rejection persists a local
  suspension, so cached audio stops across process restarts until a valid
  cloud sync succeeds.
- At enrolment, the Edge registers a separate Ed25519 proof public key. A
  private-key-signed, hash-chained, append-only local journal records the
  exact signed manifest, player, content, source, session and event time.
  Journal failure prevents starting playback. The cloud verifies the key,
  chain, historical manifest, player/facility scope, source choice and event
  order. Replays are idempotent; altered replays are rejected. Accepted
  events create ordinary `PlayoutIntent` and `ProofOfPlayEvent` rows for C7
  reporting, with full 64-hex manifest identity retained in immutable Edge
  evidence and separate occurrence/ingestion times. These are machine/player
  delivery claims, never proof of human listening.
- Super Admin can prepare/rotate/revoke nodes and inspect narrow fleet health.
  Inside Tier 4/5 authority can view only its own fleet health. No page shows
  decrypted catalogue media. Decommission still requires verified local
  removal of encrypted cache and keys; remote secure erase is **not** claimed.
- The isolated PostgreSQL migration database applied 129 migrations.
  Synthetic route-level tests cover one-use enrolment, Tier 3 denial,
  cross-facility media denial, signed manifests, protected R2, withdrawal,
  proof forgery, replay/deduplication and C7 report materialisation. Pure
  runtime tests cover atomic cache, delta reuse, corruption quarantine,
  expiry, suspension, player grants and C6/C7 precedence.
- An isolated full-stack synthetic run starts the actual cloud app, mock
  protected object storage and local Edge HTTP runtime. A dedicated loopback
  TCP bridge carries only Edge-to-cloud traffic; the test closes that listener
  and its connections, verifies Edge sync fails while the cloud app remains
  reachable, and confirms local private delivery and accumulating proof.
  It withdraws the programme in the cloud while the Edge link is down, then
  reconnects, evicts the content, uploads the signed backlog exactly once
  and verifies both C7 operational metrics and CSV evidence. This is a real
  transport interruption, but it is **not** a facility LAN/TLS or human-audible
  test and therefore does not by itself satisfy the final live gate.

## Open C8 release gates — do not merge

### C8.1 implementation in progress (isolated validation, not release evidence)

- Super Admin may bind exactly one active Edge endpoint to an existing
  facility. Production endpoints require HTTPS. The existing private player
  obtains the bound node, facility, zone, manifest version and Edge proof
  public key from its authenticated cloud state; it never accepts a listener
  supplied LAN URL. Before sending a short-lived cloud-signed grant, the
  browser verifies a fresh nonce challenge signed by that same Edge identity.
  An exact cloud-player origin is required for Edge CORS. A browser-to-facility
  TLS certificate and private-network browser policy remain live deployment
  gates, not assumptions from route tests.
- The local browser lease is scoped to the node, organisation, facility,
  player, zone and exact manifest. A five-minute access token can renew locally
  against the same unexpired signed manifest, so a previously approved player
  can keep operating during a cloud outage. A random media-session ticket
  permits native browser audio requests without an open media directory; the
  Edge re-resolves the current approved item for each range request and stops
  on manifest change, suspension or expiry. A ticket is a bearer secret in a
  browser URL, so local TLS, no-store responses, restricted origin and
  no-referrer headers are required; this is not DRM.
- Licensed catalogue sync is deliberately narrow: only exact near-future,
  staff-scheduled C5 song requests for a pinned player/zone enter a signed
  Edge insertion. Rights use, territory, subscription catalogue level,
  central/facility Corrections policy, current programme review and content
  checksum are rechecked before inclusion and again before cloud media
  transfer. No full-catalogue mirror or independent Corrections AutoDJ pool
  is introduced. Provider identity remains abstract; Edge receives no supplier
  URL or credential. The isolated test proved eligible delivery and central
  block, facility block, tier downgrade, takedown and cross-facility denial.
- Synthetic tests passed for attestation, grant-to-lease handoff, private
  browser media ticket, invalid ticket, wrong browser origin and suspension;
  the isolated full-stack test passed for signed licensed inclusion, private
  C7 media, disconnected replay, withdrawal on reconnect, proof upload and
  C7 reporting. These use synthetic bytes and **do not** establish audible
  local-player performance.

- On 29 September 2026, an isolated loopback lab applied all 130 migrations
  to a disposable PostgreSQL cluster and opened two separately enrolled
  browser-player instances (Chrome and the Codex browser) on distinct zones.
  Both displayed the signed Central programme and their browser audio
  elements were playing. The local Edge uploaded 774 signed playback events
  before teardown. The operator did not confirm hearing the baseline tone
  before that first attempt was stopped; its offline/C7/C6 browser sequences
  were not run. The lab used the development-only loopback HTTP exception,
  not production-valid Edge TLS. The 12 Edge unit tests and the general suite
  (975 passed, 8 skipped) passed during this attempt.

- A second isolated loopback run used fresh test identities. The operator
  confirmed both Central tones, both players' continued bounded playback
  after cloud withdrawal while the Edge TCP bridge was closed, both audible
  Priority and Emergency interruptions and returns, and both players stopping
  after withdrawal reached the Edge on reconnect. The player screens also
  showed Local on both zones during the offline C7 window and Central again
  afterward; the operator confirmed the audible return, but did not explicitly
  confirm the higher Local phase in that run. At one offline
  snapshot, 234 signed proof events were queued locally; reconnect uploaded
  the backlog. After withdrawal, the active manifest changed, the queue was
  empty, and a repeat sync uploaded zero events without changing the 1,570
  accepted-event count. This remains a one-machine loopback test without
  production-valid Edge TLS, real facility LAN separation or appliance
  hardening. It is useful integration evidence, **not a C8 release PASS**.

- A third isolated loopback replay on 29 September 2026 specifically checked
  the missing audible C7 transition. With two separately enrolled browser
  players, the operator heard the middle Central tone from both, then the
  higher Local tone from both while the Edge-to-cloud TCP bridge was closed,
  then a continuous return to the middle Central tone on both after the
  one-minute Local window. Both player screens showed the matching programmes.
  The Edge reported `cloudConnected: false` and 161 pending signed proof events
  during the return; reconnect uploaded 189 queued events and reported zero
  pending. The disposable lab test passed and was shut down. This resolves the
  loopback audible Local confirmation gap, but does **not** satisfy the real
  facility LAN/TLS release gate or make C8 production ready.

- The loopback browser test exercises real Edge-to-cloud TCP disconnection,
  two local players, queued proof, reconnect, changed manifest and dedup.
  The remaining *live* gate must repeat this with production-valid browser
  TLS, a genuinely separate facility LAN/Edge appliance and cloud route,
  and confirm heartbeat, reporting and audible playback there. A same-host
  loopback bridge is not equivalent to that deployment.
- Repeat live tests for withdrawal while offline, expired manifest, corrupted
  media with online repair, credential rotation/revocation, cross-facility
  attack, C7 multi-facility distribution and C6 Priority/Emergency/return.
- The catalogue and browser handoff now have code and isolated tests, but
  remain incomplete release gates until a real browser/facility Edge runs with
  valid TLS, two local players, audible offline C7 and connected C6 sequences.
- Full C1–C7, Studio, six existing products, recovery, catalogue, security,
  static and CI regression remains to be completed. Keep the PR Draft.

## Residual threat notes

A stolen machine credential can impersonate its one facility until revoked;
the separate proof key is required to forge delivery evidence. A stolen disk
without the separately provisioned cache key has encrypted objects, but a
fully compromised Edge host can access audio while it plays. Offline
revocation is unknowable until reconnect and is bounded by manifest expiry;
online 401/403 suspends the local player service. Local wall-clock rollback is
checked against a MAC-protected trusted-time record plus monotonic time while
the process runs; a hostile administrator with both the encryption key and a
full disk snapshot can still roll back state across reboot. Physical hardening
and trustworthy time are deployment requirements, not solved by application
code alone.
