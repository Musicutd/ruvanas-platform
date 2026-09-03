# Stage 18H — Subscriber Team & Access Management

Stage 18H gives each subscriber a professional organisation workspace for profile details, team roles and private staff invitations.

## Subscriber journey

1. Open **Organisation & team** from the subscriber dashboard.
2. Review the organisation plan, service status and current staff access.
3. Create a private, one-time invitation for a manager, content editor or viewer.
4. Share the link through the organisation's approved private channel.
5. The recipient verifies an existing Ruvanas account or creates a password for a new account.
6. Owners and managers can adjust permitted roles, revoke unused invitations and remove access.

## Authority boundaries

- Owners can invite managers, content editors and viewers.
- Managers can invite and manage content editors and viewers only.
- Nobody can use this workflow to grant `OWNER`, `SUPPORT`, `SUPER_ADMIN` or `STUDENT` access.
- Owners cannot remove or downgrade themselves; another owner-controlled process is required for ownership transfer.
- Viewers see colleague names and roles but not colleague email addresses.
- Invitations expire after seven days, are stored only as hashes and become unusable after acceptance or revocation.

## Audit and session controls

- Organisation profile updates, invitations, acceptance, role changes, revocation and member removal are written to the audit log.
- Removing a member clears that organisation from the member's active sessions immediately.
- The invitation token stays in the URL fragment so normal server access logs do not receive it.

## Deployment

Stage 18H adds the `OrganisationInvitation` table. Production deployment must run the existing Prisma migration command before the web process starts.
