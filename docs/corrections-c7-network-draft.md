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
  its evidence, and deactivates its linked planned windows.
- Weekly central/local windows now require an exact, approved distribution;
  local windows must reference a version originating at the target facility.
  The private player can resolve them into the existing signed manifest and
  `PlayoutIntent` proof path. Precedence is C6 Emergency/Priority, then a
  mandatory central window, local window, and optional central default.
  Invalid local content falls through to the approved central candidate.
  This is **not yet live validated** and has no general private AutoDJ fallback.
- The Tier 4/5 network dashboard and bounded CSV export aggregate existing
  player proof by facility, source and status without contributor/request text.
  These counts are device delivery evidence, not individual listening.
- C6 facility Emergency/Priority controls remain unchanged. There is no
  authority-wide Emergency action.

## Release blockers

1. Run a disposable database/player test of the new central→local→central
   resolver, including signed proof, C6 interruption, source withdrawal,
   offline devices and a real media fetch. Prove that it does not create a
   playback gap or false delivery claim. Current unit checks are insufficient.
2. Finish a safe, approved private AutoDJ fallback for periods where neither
   local nor central media can play, with a visible operational alert. Do not
   reuse the public fallback or weaken the general Corrections schedule lock.
3. Add private facility-to-authority and selected-facility syndication review,
   centrally targeted announcements and rehabilitation assignment. Do not
   expose contributor or family-request details across facilities.
4. Verify bounded, tenant-scoped network export against seeded player proof and
   run a privacy/security review. The current CSV and aggregate endpoint have
   only focused filter/empty-report coverage.
5. Run a disposable non-production database and browser/player E2E across a
   Tier 4 authority and three facilities, including group targeting, policy
   restrictions, central→local→central return, withdrawal and safe fallback.
   The pure window test is not a substitute for this E2E.
6. Validate the migration on the disposable database and rerun C1–C6,
   Studio, player, product and Super Admin regression checks before requesting
   review. Production migrations and deployment remain prohibited.

The existing production Render service must retain Auto-Deploy OFF. C8 and
Secure Edge are out of scope for this branch.
