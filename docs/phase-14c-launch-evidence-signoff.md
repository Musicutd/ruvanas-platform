# Stage 14C: launch evidence closure and controlled pilot sign-off

Stage 14C turns the Stage 14B operator checklist into an attributable, append-only sign-off workflow for one paid-service release. It does not weaken automated readiness, resolve incidents automatically, invent backup evidence, deploy code, publish content, or grant legal/commercial approval.

## Delivered scope

- Super Admin-only confirmation records for each external launch check.
- Safe evidence references and accountable notes without credentials, private links, customer content, recipient data, or student data.
- Release-specific records keyed to the paid environment and active commit so a later deployment cannot inherit an earlier approval.
- Append-only confirmation, revocation, final sign-off, and withdrawal events using the existing audit log.
- Final sign-off available only when automated readiness is `READY_FOR_OPERATOR_SIGN_OFF` and every required external confirmation is current.
- A previously recorded sign-off becomes non-current whenever automated readiness degrades.

## Required operator confirmations

1. GitHub CI and final platform acceptance passed for the active commit.
2. The paid `ruvanas-platform` deployment is live on that commit.
3. The bounded public smoke passed without customer-data changes.
4. The free staging web service remains suspended.
5. Business and legal approval exists for the precisely named launch scope.

These confirmations are human assertions backed by external evidence. Ruvanas never marks them complete merely because the application is reachable.

## Safety and privacy

- Only a platform Super Admin can read or write launch sign-off evidence.
- Every mutation is append-only and records the actor, request reference, environment, commit, safe evidence reference, and note.
- Revoking any required confirmation invalidates the final sign-off until all conditions are satisfied again.
- The final sign-off does not override live operational or recovery blockers.
- No schema migration or customer-data change is introduced.

## Verification

- Unit tests cover release identity, complete-check requirements, revocation, and degraded-readiness invalidation.
- Route security continues to require authenticated platform Super Admin access.
- Repository integrity, Prisma validation, full tests, production build, and final acceptance must pass before publication.

## Rollback

Remove the Stage 14C resolver, tests, route mutations, and sign-off UI. Existing audit records remain harmless historical evidence and the Stage 14B read-only readiness gate continues to function.
