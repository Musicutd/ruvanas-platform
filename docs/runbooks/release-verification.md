# Stage 13A release verification runbook

## Before merge

1. Confirm the pull request targets `main` and contains only the approved stage.
2. Confirm CI installed from the lockfile with general package scripts disabled, explicitly prepared only the pinned FFmpeg package, passed static integrity and the production dependency audit, validated Prisma, applied a clean database, verified FFmpeg/FFprobe, passed tests, built the application, and completed both security and release smoke checks.
3. Do not bypass a failed gate. Correct the fault in a new commit and let the complete workflow run again.
4. Review every migration as forward-only. Confirm a verified backup or snapshot reference before structural production migrations when provider capability requires it.

## Production release

1. Merge only after all required GitHub checks pass.
2. Deploy only the paid `ruvanas-platform` service. Keep the free staging service suspended.
3. Confirm the paid deployment checks out the approved merge commit.
4. Confirm the build succeeds and every pending migration is applied once through `prisma migrate deploy`.
5. Confirm the new instance starts and Render reports the deployment as live before treating the release as complete.

## Non-destructive live smoke

- Load the public home page and login page.
- Confirm unauthenticated access to `/dashboard` and `/admin/recovery` redirects to login.
- Confirm protected APIs return an attributable `401` response without exposing secrets or internal records.
- Sign in only when an authorised operator is available, then check the changed workflow and one unchanged core retail/player workflow.
- Do not upload media, publish campaigns or school episodes, send player commands, or trigger external notifications merely to prove general availability.

## Failure and rollback

- Preserve the failing CI or deployment evidence and safe commit identifier.
- If the build fails, do not deploy manually from another branch.
- If a pre-deploy migration fails, follow the database migration failure procedure in the operational observability runbook; do not edit an applied migration or use schema push in production.
- If the new application fails after a successful additive migration, roll back only to a version confirmed compatible with the current schema.
- Close the release incident only after the paid service is stable, core authentication and player access work, and the free staging service remains suspended.
