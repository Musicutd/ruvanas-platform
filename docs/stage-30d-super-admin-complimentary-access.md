# Stage 30D — Super Admin-only complimentary access

## Outcome

Complimentary access is now controlled exclusively from the Ruvanas Super Admin area. Client organisation owners, managers and other members cannot grant or activate free service.

## Changes

- Removed Complimentary access from the client sidebar.
- Removed the client activation form and code-entry workflow.
- Redirected the former client page to Account & Plan, or to the Super Admin control page for a Super Admin.
- Disabled the client activation API so direct requests cannot change access.
- Changed the Super Admin workflow from issuing a client code to granting the selected tier immediately.
- Kept the client Account & Plan page read-only so the organisation can still see when complimentary service is active.
- Kept revocation under Super Admin control.
- Existing unused codes are cancelled automatically when a Super Admin grants direct access.

## Safety boundaries

- Every grant and revocation remains recorded in the audit log.
- No plaintext access code is returned, displayed or copied.
- No billing event is created by a complimentary grant.
- Complimentary access remains active without automatic expiry until a Super Admin stops it.
- No database migration is required.
