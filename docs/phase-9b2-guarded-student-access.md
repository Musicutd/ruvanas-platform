# Stage 9B2 — Guarded Student Access

Stage 9B2 introduces a deliberately narrow, invitation-only student workspace. It is available only to a school whose Stage 9A policy pack has been approved in Stage 9B1 with `INVITATION_ONLY` as its student identity mode.

## Controlled invitation workflow

1. An organisation owner or manager selects an existing active `StudentContributor`.
2. The platform confirms the school's approved safeguarding decision and current school-level consent for that contributor.
3. Ruvanas creates a cryptographically random, seven-day invitation and stores only its hash.
4. Staff share the one-time link through the school's approved private channel.
5. The student accepts the invitation, chooses a password, and receives a `STUDENT` user account linked through `SchoolStudentAccess`.
6. The invitation token is removed immediately after acceptance.

Reissuing an unaccepted invitation invalidates the earlier link. Revoking an invitation or active access removes the invitation token and revokes every active session for that student.

## Separate least-privilege workspace

A student is never given an `OrganisationMember` record. The dedicated `/school-student` workspace exposes only the linked contributor's:

- open assignments and staff-defined rubric criteria;
- supervised school episodes;
- submission history and staff assessments only after release; and
- private portfolio entries.

The workspace is read-only in this stage. Existing staff, client, administration, media, scheduling, publishing, network-exchange, and analytics APIs continue to require adult organisation membership or platform authority.

## Continuous safety gate

Access is checked on every student workspace request. It becomes unavailable when:

- the student access record is revoked;
- the contributor becomes inactive;
- the safeguarding pack is no longer approved;
- the approved identity mode is no longer invitation-only; or
- the latest school-level consent is revoked, expired, or otherwise not granted.

## Hard exclusions

Stage 9B2 does not provide:

- staff dashboard or administration access;
- direct or private messaging;
- public publishing;
- cross-school authority;
- student uploads or unsupervised editing; or
- automatic identity federation.

Those boundaries are represented in API responses and covered by unit and route-level security tests.
