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
- Weekly central/local windows are *planning records*. Mandatory central blocks
  win; local blocks may cover only optional central defaults. The private player
  has **not** been connected to these records. No network schedule or
  distribution record currently authorises live playback.
- C6 facility Emergency/Priority controls remain unchanged. There is no
  authority-wide Emergency action.

## Release blockers

1. Implement the Corrections-specific live schedule resolver and signed player
   delivery for central/local windows, with current Guard, rights, source,
   target facility policy, channel and player checks at publication and manifest
   time. Preserve the existing general Corrections scheduler lock.
2. Give local windows an approved, version-pinned local content selection and
   a tested central/default fallback when local content is invalid or absent.
   Verify Emergency > Priority > mandatory central > approved local > central
   default without changing C6 return-to-current-programme behaviour.
3. Add private facility-to-authority and selected-facility syndication review,
   centrally targeted announcements and rehabilitation assignment. Do not
   expose contributor or family-request details across facilities.
4. Add bounded, tenant-scoped network proof/export endpoints and audit drill-down.
   Operational counts must remain separate from claims about individual
   listeners or rehabilitation outcomes.
5. Run a disposable non-production database and browser/player E2E across a
   Tier 4 authority and three facilities, including group targeting, policy
   restrictions, central→local→central return, withdrawal and safe fallback.
   The pure window test is not a substitute for this E2E.
6. Validate the migration on the disposable database and rerun C1–C6,
   Studio, player, product and Super Admin regression checks before requesting
   review. Production migrations and deployment remain prohibited.

The existing production Render service must retain Auto-Deploy OFF. C8 and
Secure Edge are out of scope for this branch.
