# C7 Inside Network: draft foundation and release stop

This branch is **not C7-complete**. It must not be merged or deployed as the
finished Multi-Facility Network Operations release.

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
  mandatory central window, local window, and optional central default.
  Invalid local content falls through to the approved central candidate.
  Disposable CI checks the private manifest, protected synthetic-tone media
  fetch and signed proof for three facilities. This is **not yet real-player or
  audible live validated** and has no general private AutoDJ fallback.
- The Tier 4/5 network dashboard and bounded CSV export aggregate existing
  player proof by facility, source and status without contributor/request text.
  The C7.2 export now offers date, facility/group, central/local, content type,
  exact programme/rehabilitation/announcement and delivery-status filters. Each
  bounded CSV row retains its source proof event, exact playout intent and
  source revision rather than only a grouped count. This is device delivery
  evidence, not individual listening. Disposable CI must still validate the
  generated file against actual seeded proof before the report gate can pass.
- The dashboard now separates completed central/local programmes,
  rehabilitation, announcements and request delivery from STARTED, FAILED and
  INTERRUPTED events. Categories without a working runtime remain at zero;
  these counters do not substitute for live distribution validation. It also
  labels degraded facilities and sums central/local delivered hours solely
  from completed, signed player proofs.
- C6 facility Emergency/Priority controls remain unchanged. There is no
  authority-wide Emergency action. Disposable C7 CI exercises Priority and
  Emergency over an active local window and verifies the current local source
  is re-resolved after each clear; audible live validation is still required.

## Release blockers

1. Run an actual isolated three-player central→local→central test, including
   C6 interruption, source withdrawal and offline devices. CI now verifies
   protected synthetic audio delivery, signed proof and withdrawal evidence,
   but not audible player transitions, gap-free return or offline recovery.
2. Finish a safe, approved private AutoDJ fallback for periods where neither
   local nor central media can play, with a visible operational alert. Do not
   reuse the public fallback or weaken the general Corrections schedule lock.
3. Add private facility-to-authority and selected-facility syndication review,
   centrally targeted announcements and rehabilitation assignment. Do not
   expose contributor or family-request details across facilities.
4. Verify the expanded tenant-scoped, proof-level network export against seeded
   player proof in disposable CI and run a privacy/security review. The report
   work alone does not complete network analytics or the live release gate.
5. Run a disposable non-production database and browser/player E2E across a
   Tier 4 authority and three facilities, including group targeting, policy
   restrictions, central→local→central return, withdrawal and safe fallback.
   The pure window test is not a substitute for this E2E.
6. Validate the migration on the disposable database and rerun C1–C6,
   Studio, player, product and Super Admin regression checks before requesting
   review. Production migrations and deployment remain prohibited.

The existing production Render service must retain Auto-Deploy OFF. C8 and
Secure Edge are out of scope for this branch.
