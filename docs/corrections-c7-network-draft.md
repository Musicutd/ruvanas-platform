# C7 Inside Network: release-validation record

The C7 software gates and isolated three-player live validation passed on
2026-09-27. This is acceptance of the code foundation, **not** permission to
deploy Ruvanas Inside to production. Production Render Auto-Deploy remains Off;
no production migration or deployment is part of this release gate.

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
  Disposable CI and three actual browser players checked the private manifest,
  protected synthetic-tone media fetch, signed proof and audible isolation.
  The fallback is an approved, version-pinned
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
  source revision rather than only a grouped count. Group-targeted distributions
  also preserve the group ID and name at distribution time, so later changes to
  group membership or name cannot rewrite historical proof. This is device delivery
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
  Emergency over active private programming and verifies the current valid
  source is re-resolved after each clear. Three browser players and a human
  listener confirmed Priority interrupted only A and returned to Local A;
  Emergency interrupted only A and returned to the current Central fallback.

## Final isolated release evidence

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
| Three real browser players | COMPLETE/PASS | A/B/C played distinct synthetic WAVs concurrently; a human listener confirmed the key central/local/return transitions. |
| Facility group | COMPLETE/PASS | Group North reached A+B, not C; player proof and CSV tie the exact group to A/B's approved version. |
| Offline player | COMPLETE/PASS | B disconnected, had no delivery proof for the expiring item, and rejoined on the current fallback without replay. |
| C6 audible precedence | COMPLETE/PASS | Human listener confirmed Priority and Emergency interruption and return; interrupted intents had no false completion. |

The fallback here is a separately approved, version-pinned private programme,
not a general AutoDJ music rotation. No public AutoDJ content can enter Inside.

The synthetic lab used a disposable local PostgreSQL database and three
separate browser player sessions. A human listener confirmed central/local
switching, concurrent facility isolation, rehabilitation and announcement
targeting, syndication, group distribution, private fallback, and C6 Priority
and Emergency return. Signed STARTED/COMPLETED/INTERRUPTED proof and the bounded
CSV were correlated with those observations. Failed or offline playback was
not counted as delivered. The focused C7 integration test, full unit suite,
static checks, Prisma generation/migration and production-style build passed.
GitHub CI and the final PR merge decision remain separate checks.

The existing production Render service must retain Auto-Deploy OFF. C8 and
Secure Edge are out of scope for this branch.
