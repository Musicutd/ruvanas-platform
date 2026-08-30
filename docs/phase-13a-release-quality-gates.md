# Stage 13A: release quality and regression assurance

Stage 13A closes the remaining CI and release-verification gaps in the master build specification without changing customer data, tenant behaviour, subscription rules, or production infrastructure.

## Required pull-request gates

- Install exactly from the committed lockfile.
- Reject unresolved merge markers, trailing whitespace, missing final newlines, and NUL bytes in project text files.
- Audit production dependencies and fail on high or critical advisories.
- Generate and validate the Prisma client and schema.
- Apply every migration to a clean PostgreSQL database.
- Prepare only the FFmpeg package's pinned install script after the general dependency install has skipped all package scripts, then verify the packaged FFmpeg and FFprobe binaries used by protected audio processing.
- Run the database-backed unit suite and production Next.js build.
- Start the built application and run route-level tenant/security tests.
- Run a small release smoke suite across the public site, player enrolment, protected dashboards, Super Admin recovery, platform health, and notifications.

No pull request should be merged when a required gate fails. The release smoke checks are intentionally non-destructive and do not upload media, send player commands, publish school content, or contact external notification providers.

## Deployment boundary

The paid `ruvanas-platform` service remains the only deployment target. The retired free `ruvanas-platform-staging` service stays suspended. Production migrations remain forward-only and are applied through the controlled pre-deploy step after CI passes and the approved pull request is merged.

## No database migration

This stage changes only repository verification, CI, tests, and documentation. It adds no schema migration and does not rewrite existing data.
