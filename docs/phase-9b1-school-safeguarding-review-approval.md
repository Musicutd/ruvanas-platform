# Stage 9B1 — School Safeguarding Review and Approval

Stage 9B1 turns the Stage 9A readiness pack into a controlled Ruvanas review process. It deliberately stops before student accounts or public school publishing.

## Review workflow

- An organisation owner or manager completes and submits the readiness pack.
- The submitted pack becomes read-only while it awaits review.
- A Ruvanas Super Admin reviews territory, age, consent, identity, privacy, retention, policy, and mandatory safety declarations.
- The reviewer either approves the readiness pack or requests changes with mandatory notes.
- A change request reopens the pack for the school to revise and resubmit.
- An approved pack remains locked as reviewed evidence.

## Evidence and audit

Every decision creates an immutable `SchoolSafeguardingReview` record containing:

- the decision and review notes;
- the reviewer and decision time;
- the policy version; and
- a JSON snapshot of the complete submitted readiness pack.

The platform audit trail separately records approvals and change requests for the relevant organisation.

## Access boundary

Approval is a prerequisite decision, not an access switch. Stage 9B1 never enables:

- student login;
- direct messaging;
- unsupervised student operation; or
- public publishing.

A later, separately reviewed milestone may introduce guarded invitations only for organisations with an approved readiness pack.
