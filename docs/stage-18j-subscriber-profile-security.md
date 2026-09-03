# Stage 18J — Subscriber Profile & Security Centre

## Purpose

Stage 18J gives non-student subscribers a safe place to manage their personal Ruvanas identity without exposing administration controls or private authentication data.

## Subscriber experience

- Update a personal display name while keeping the sign-in email read-only.
- Change a local password only after the current password is verified.
- Use a minimum 12-character replacement containing a letter and number.
- Automatically sign out all other sessions after a successful password change.
- Review safe summaries of active sign-ins, including authentication type, organisation, last activity and expiry.
- Sign out one other session or all other sessions while keeping the current device connected.
- Show clear company sign-in guidance when an organisation has disabled local password changes.

## Security boundaries

- Every request is scoped to the authenticated user and their active organisation membership.
- Student identities stay inside the supervised school workspace.
- Current sessions cannot be revoked through the individual-session action.
- Session tokens, hashes, network addresses and identity-provider identifiers are never returned.
- Password changes and profile updates are rate limited and written to the audit trail.
- Security responses are private and not cached.
- The existing enterprise sign-in policy remains authoritative.

## Release validation

- Helper tests cover profile names, password rules, enterprise policy and safe session presentation.
- Source assurance verifies user scoping, current-session protection, password hashing and no private-field selection.
- Interface checks cover password autocomplete, status feedback, confirmation and responsive keyboard-visible styling.
