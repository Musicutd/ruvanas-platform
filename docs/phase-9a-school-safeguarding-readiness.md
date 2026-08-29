# Stage 9A — School Safeguarding Readiness

Stage 9A creates the policy-readiness layer required before Ruvanas considers guarded student access. It advances the master specification without weakening the current staff-managed boundary.

## School readiness pack

Organisation owners and managers can record:

- target countries using two-letter country codes;
- the supported student age range;
- whether consent is governed by school policy, a parent or guardian, or both;
- the intended future identity approach: disabled, school-managed invitation, or school identity federation;
- the school privacy contact;
- raw-recording and consent-evidence retention periods;
- the approved local safeguarding or privacy policy reference; and
- local review notes.

Submission requires three explicit declarations: staff moderation before publishing or sharing, no direct student messaging, and private-by-default student work. Incomplete packs remain drafts and return a concrete checklist of missing decisions.

## Safety boundary

This stage does not create student users, invitations, sign-in routes, messages, public feeds, or public-publishing capability. The requested identity method is planning data only. API responses always report direct student access, direct messaging, and public publishing as disabled.

Changing a submitted pack returns it to draft until an owner or manager submits the complete record again. Submission creates audit evidence but is not represented as legal approval or automatic product activation.

## Tenant and role controls

- School Radio entitlement and an active organisation are required.
- Owners, managers, and content editors can read the readiness state.
- Only owners and managers can save or submit it.
- The organisation is derived from the authenticated session; callers cannot provide another organisation ID.
- Audit details include operating scope and hard-disabled capability flags, but omit the privacy contact and private notes.

## Validation and evidence

The database enforces unique organisation ownership, valid age order, and bounded retention periods. Unit tests cover country normalisation, complete and incomplete packs, age and retention limits, and the permanent access locks. Route-security coverage verifies that the API cannot be read without authentication. CI validates the additive migration and production build.
