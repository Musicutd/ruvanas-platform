# Stage 12D — Backup and recovery readiness

## Outcome

Stage 12D adds a provider-neutral Super Admin control centre for database and protected-storage recovery readiness. It records only confirmed controls, safe evidence references, recovery targets, and restore-drill results. It does not copy backups, perform provider operations, store credentials, or treat configuration exports as database backups.

## Controls

- Database readiness requires a confirmed strategy and confirmed automated backups.
- Protected-storage readiness requires a confirmed strategy plus either automated backup recovery or object versioning.
- RPO and RTO values can be recorded only after the operating strategy has been confirmed against the active paid production environment.
- Passed backup verification must remain current: 48 hours for the database and seven days for protected storage.
- Passed restore drills are expected at least every 90 days.
- Failed latest verification or restore evidence makes the affected asset not ready.
- Every control update and evidence record is restricted to a Ruvanas Super Admin and creates an immutable audit entry.

## Evidence boundary

Evidence references are short operational identifiers, not private URLs. Query strings, credentials, provider tokens, database copies, customer content, media, webhook payloads, recipient data, and student data must never be entered. Evidence history is additive; failed or superseded results remain available for audit.

## Deployment safety

Apply migration `20260929000000_stage_12d_backup_recovery_readiness` before the application release. The migration only adds enums, tables, indexes, checks, and foreign keys. Rollback may leave the tables in place because earlier releases ignore them. Deploy only the paid `ruvanas-platform` service and keep the free staging web service suspended.

After deployment, the Super Admin should open **Backup & recovery**, verify the displayed production environment, and record controls only after confirming the provider settings. A release is not evidence that backups or restores work.

Operational steps are in [the Stage 12D recovery runbook](runbooks/backup-recovery-readiness.md).
