# Stage 14D: protected-media backup and restore assurance

Stage 14D closes the remaining technical launch blocker without changing production media, customer records, database schema, public delivery, or the suspended free staging service. It adds provider-neutral, S3-compatible backup tooling for the private protected-media bucket.

## Delivered scope

- A mandatory isolated backup bucket; the command refuses to run when the source and destination buckets are the same.
- Single-use snapshot and drill paths that refuse identifier reuse and never delete or overwrite production objects.
- Streaming SHA-256 verification so large audio files do not need to be held fully in memory.
- Full source SHA-256 calculation before each copy.
- Conditional source reads and copies that fail if an object changes during snapshot creation.
- Per-object size, checksum and bounded metadata evidence in a deterministic private snapshot manifest.
- Full verification that downloads every backup object and compares its checksum with the snapshot manifest.
- A non-destructive restore drill that copies one backed-up object into an isolated drill prefix, reads it back and verifies the checksum.
- Safe summary output containing counts, byte totals, snapshot identifiers and recovery-register evidence references—never access keys, object names, customer content or signed URLs.
- Explicit configuration examples and an operational runbook.

## Activation boundary

The software remains dormant unless `R2_BACKUP_BUCKET_NAME` is configured. Creating the separate bucket, applying retention protection and granting least-privilege credentials are infrastructure decisions that may affect provider charges and must be approved separately. Stage 14D does not claim that a backup exists merely because the tooling is deployed.

## Commands

```text
npm run backup:protected-media
npm run verify:protected-media-backup
npm run drill:protected-media-restore
```

Use `-- --snapshot=SAFE_ID` to select a specific snapshot for any command. The restore drill accepts an optional `--drill=SAFE_ID` and writes only beneath the configured drill prefix in the backup bucket.

## Recovery evidence

After a successful backup and full verification, record the emitted `r2-backup-*` reference as a protected-storage `BACKUP_VERIFICATION`. After a successful isolated drill, record the emitted `r2-restore-*` reference as a `RESTORE_DRILL` with the reported duration. Do not record either result when the command fails or when provider retention settings have not been verified.

## Rollback

Remove the Stage 14D library, script, tests, package commands, documentation and optional environment variables. Production media is never changed. Retain existing backup snapshots and audit evidence until the approved retention policy permits removal.
