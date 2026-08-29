# School Radio expansion architecture

## Purpose

School Radio is a future Ruvanas product mode for staff-supervised student broadcasting. It should extend the existing multi-tenant radio platform, not become a separate application or duplicate the streaming system.

This document creates the architectural boundary now. It does not add school-specific database tables or expose unfinished school features in the current product.

## Product boundary

The shared Ruvanas core continues to own:

- organisations, memberships, roles, subscriptions, and entitlements;
- brands, locations, location groups, zones, and channels;
- media storage, playlists, schedules, players, streaming, and analytics;
- security, audit history, notifications, and operational administration.

School Radio becomes an optional organisation capability. A future entitlement such as `SCHOOL_RADIO` should enable its routes, navigation, APIs, and workflows. Retail and in-house customers should see no school-specific interface when the capability is disabled.

## Recommended module layout

```text
app/
  school-radio/
    programmes/
    episodes/
    schedule/
    studio/
    review/
    announcements/
lib/
  school-radio/
    access.js
    policy.js
    workflow.js
    validation.js
    publishing.js
tests/
  school-radio/
```

Route handlers should remain thin. School Radio policy, workflow, and publishing rules belong in `lib/school-radio` so they can be tested without the user interface.

## Future domain model

The initial model should be added only after the core organisation and scheduling foundations are stable.

- `SchoolProfile`: one-to-one school settings for an organisation, including publishing policy and safeguarding contacts.
- `AcademicPeriod`: academic year and optional terms used to organise programming.
- `StudentGroup`: a class, club, or production team. It is not an authentication group.
- `Programme`: the continuing show identity, owner group, supervisors, description, and artwork.
- `Episode`: an individual production with status, media, contributors, and publication settings.
- `BroadcastSlot`: a scheduled occurrence that links an approved episode or live programme to an existing Ruvanas channel.
- `StudentContributor`: a school-managed, minimal profile or pseudonym. It should not automatically be a normal platform user.
- `SchoolStudentAccess`: an optional, separately approved invitation link between one contributor and a least-privilege student user. It never creates organisation membership.
- `StaffSupervisor`: a link between an existing authorised membership and the programmes or groups they supervise.
- `ConsentRecord`: minimal evidence of the applicable school or guardian consent, its scope, expiry, and revocation. Avoid storing document contents unless required.
- `Submission`: an uploaded recording, script, artwork, or metadata revision awaiting review.
- `ModerationReview`: an immutable decision, reviewer, timestamp, reason, and policy version.
- `SchoolAnnouncement`: a staff-created bulletin that can use the existing scheduling and playback core.

All school records must carry `organisationId` directly or through an enforced parent. Every query and mutation must resolve the active organisation and verify membership before accessing data.

## Editorial workflow

```text
Draft -> Submitted -> Staff review -> Approved -> Scheduled -> Broadcast -> Archived
                    \-> Changes requested -> Draft
                    \-> Rejected
```

Only authorised staff can approve, schedule, publish, or restore content. A student contributor may draft or submit only within the school policy and their assigned group. Publishing changes after approval should create a new review requirement.

## Roles and permissions

Use permissions, not hard-coded page checks. Suggested school permissions are:

- `school:manage` for school settings and safeguarding policy;
- `programme:manage` for programmes and production teams;
- `episode:draft` and `episode:submit` for content preparation;
- `episode:review` and `episode:approve` for staff editorial control;
- `broadcast:schedule` for channel scheduling;
- `school:publish_public` for public podcast or web publication;
- `moderation:audit` for authorised compliance review.

Existing platform administrators may grant roles but should not silently receive editorial approval powers unless the product policy explicitly allows it.

## Safeguarding and privacy requirements

- Default student identities to private, school-managed display names or pseudonyms.
- Do not require student email addresses or direct student logins for staff-managed participation. A later guarded workspace may collect an invitation email only after the school's safeguarding approval and current consent.
- Never expose a minor's personal data in public programme, episode, player, or analytics responses.
- Require staff approval before scheduling or publishing student-created material.
- Keep an immutable audit history of submissions, decisions, schedule changes, and publication changes.
- Support consent expiry and revocation, with a clear unpublish and retention process.
- Provide private, unlisted, and public publishing policies at organisation level; default to private.
- Prohibit private adult-to-student messaging in the product. Communication should use supervised school workflows.
- Define retention and deletion periods with the school before storing raw recordings or consent evidence.

Legal and safeguarding requirements vary by country and school. Product discovery must confirm them before enabling real student data.

## Reuse rules

- Reuse existing `Channel`, player enrolment, streaming, media storage, and scheduling services.
- Extend the shared schedule through `BroadcastSlot`; do not build a second playback scheduler.
- Reuse organisation membership for adult staff. Keep student contributor identity and guarded student access separate from organisation membership.
- Add capability checks at navigation, page, API, and service layers. Hiding a menu item is not access control.
- Keep School Radio APIs under an explicit namespace and include organisation-scoping tests for every operation.

## Delivery plan for later

### S0 - Discovery and safeguarding

Confirm target countries, student age ranges, school policy, consent rules, retention, public publishing, and staff responsibilities. Produce approved threat and privacy models.

### S1 - School foundation

Add the `SCHOOL_RADIO` entitlement, school profile, academic periods, staff roles, audit events, and private-by-default policy. No student accounts.

### S2 - Programmes and episodes

Add programmes, staff-supervised contributor profiles, episode drafts, submissions, reviews, approvals, and changes-requested workflow.

### S3 - Studio and moderation

Add browser recording or managed uploads, media validation, scripts/artwork, moderation queues, and consent checks.

### S4 - Timetable and broadcast

Connect approved episodes and announcements to existing channels through broadcast slots. Add conflict detection, preview, and emergency override controls.

### S5 - Guarded student workspace

Only if discovery supports it, add limited student access using school-managed invitations or identity federation, least-privilege permissions, supervised collaboration, and no direct messaging.

### S6 - Publishing and analytics

Add policy-controlled podcast/web publishing, accessibility metadata, school-safe analytics, exports, retention automation, and unpublishing workflows.

## Definition of ready

Implementation should not begin until the organisation and role foundations are stable, schedule ownership is defined, the safeguarding and privacy decisions are approved, and acceptance tests cover cross-organisation isolation, staff approval, consent revocation, and public-data redaction.

