# C7 Inside Network: draft foundation and release stop

The C7.3B software gates are implemented and pass disposable CI. This draft
branch is **not release-ready** until the separate three-player live and
human-audible validation passes. It must not be merged or deployed as the
finished Multi-Facility Network Operations release yet.

## Architecture used

- One Organisation is the correctional authority; its Locations are facilities
  and its Zones are wings/areas. Existing Location Groups provide region/group
  targeting. No second tenant or public syndication system was created.
- Network powers are Tier 4+ and individually granted to non-owners. A facility
  grant does not confer network control or C6 Emergency/Priority authority.
- The existing Corrections policy checker combines rights, authority policy and
  facility policy. Local settings can tighten, but cannot relax a central block.
- Distribution rows refer to an exact Guard-approved Corrections submission and
  its Studio render. No audio file is copied. Withdrawal preserves the row and
  its evidence, deactivates linked windows, cancels issued intents that have not
  expired, and raises an operational notification. Historical proof remains.
  The private network resolver now keeps using that exact approved submission
  if a newer programme revision is approved. The dashboard labels the older
  distribution as having a new version available; it never silently swaps the
  scheduled render. A withdrawn source, changed Guard policy, missing media or
  revoked QC still fails closed. Ordinary Studio/C5 latest-revision rules are
  unchanged.
- Weekly central/local windows now require an exact, approved distribution;
  local windows must reference a version originating at the target facility.
  The private player can resolve them into the existing signed manifest and
  `PlayoutIntent` proof path. Precedence is C6 Emergency/Priority, then a
  mandatory central window, local window, optional central default, and an
  explicitly approved private fallback programme. An invalid candidate falls
  through only to the next eligible private source; recipient facility policy,
  central policy, rights, exact approval and media are checked at runtime.
  Disposable CI checks the private manifest, protected synthetic-tone media
  fetch and signed proof for three facilities. This is **not yet real-player or
  audible live validated**. The fallback is an approved, version-pinned
  programme, not a general private AutoDJ music rotation or public AutoDJ.
- Central rehabilitation and STANDARD announcements pin approved C5/C6 audio
  and target all facilities, selected facilities or Location Groups. Private
  syndication requires an exact facility-made revision and separate central
  acceptance before any selected-facility distribution. Programme origin is
  pinned at creation: owner-authored content is central; delegated authoring
  remains facility-scoped even if that author later receives network powers.
  Scheduling and runtime also reject unaccepted cross-facility distribution.
  Existing owner-authored programmes are backfilled; ambiguous history stays
  facility-scoped. Withdrawals preserve
  historical signed delivery proof and report rows.
- The Tier 4/5 network dashboard and bounded CSV export aggregate existing
  player proof by facility, source and status without contributor/request text.
  The C7 export now offers date, facility/group, central/local, content type,
  exact programme/rehabilitation/announcement and delivery-status filters. Each
  bounded CSV row retains its source proof event, exact playout intent and
  source revision rather than only a grouped count. This is device delivery
  evidence, not individual listening. Disposable CI validates the generated
  CSV against seeded, signed player proof.
- The dashboard now separates completed central/local/fallback programmes,
  rehabilitation, announcements and request delivery from STARTED, FAILED and
  INTERRUPTED events. Categories without a working runtime remain at zero;
  these counters do not substitute for live distribution validation. It also
  labels degraded facilities and sums central/local delivered hours solely
  from completed, signed player proofs.
- C6 facility Emergency/Priority controls remain unchanged. There is no
  authority-wide Emergency action. Disposable C7 CI exercises Priority and
  Emergency over an active local window and verifies the current local source
  is re-resolved after each clear; audible live validation is still required.

## C7.3B implementation stop gate

| Software gate | Status | Evidence |
| --- | --- | --- |
| Central/local runtime wiring | COMPLETE/PASS | Three synthetic facilities use private manifests and signed proof. |
| Central rehabilitation | COMPLETE/PASS | C5 approved audio, targeted distribution, withdrawal and evidence tested. |
| Central announcements | COMPLETE/PASS | STANDARD C6 audio is version-pinned and scheduled without an override. |
| Private syndication | COMPLETE/PASS | Facility origin, separate central acceptance, isolation and withdrawal tested. |
| Withdrawal/fallback | COMPLETE/PASS | Stale intents are cancelled; approved private fallback or no-source alert resolves. |
| Network analytics | COMPLETE/PASS | Delivery counts and hours derive from completed signed player proof. |
| Report export | COMPLETE/PASS | Bounded tenant-scoped CSV filters and exact historical proof/version tested. |
| Policy inheritance | COMPLETE/PASS | Authority and recipient facility restrictions are rechecked at runtime. |
| Tier enforcement | COMPLETE/PASS | Tier 4 access and Tier 3 denial tested at route level. |
| Security isolation | COMPLETE/PASS | Raw IDs, cross-facility content, unauthorised roles and public exchange denied. |
| C6 precedence | COMPLETE/PASS | Priority/Emergency interruption and return to current source tested by route. |

The fallback here is a separately approved, version-pinned private programme,
not a general AutoDJ music rotation. No public AutoDJ content can enter Inside.

## Remaining release blocker

Run the isolated three-actual-player central→local→central test across A, B and
C. Include central rehabilitation, STANDARD announcement, private syndication,
group targeting, withdrawal/fallback, facility/central policy, offline player,
and C6 Priority/Emergency return. Human listening must confirm the audible
transitions; synthetic media fetch and proof records alone cannot do that.
Until then PR #216 remains Draft and is not merge- or production-launch-ready.

The existing production Render service must retain Auto-Deploy OFF. C8 and
Secure Edge are out of scope for this branch.
