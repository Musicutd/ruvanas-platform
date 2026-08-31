# Stage 14D protected-media recovery runbook

## Safety boundary

Run these commands only against the paid Ruvanas production media bucket and an approved, separate private backup bucket. Keep the free staging service suspended. Never paste credentials, object names, customer content, student data, signed URLs or full provider-console links into logs or recovery evidence.

## Prepare the isolated destination

1. Create a private backup bucket in the approved region and account.
2. Apply the approved retention or immutability policy before accepting production backups.
3. Grant the Ruvanas backup identity read access to the production bucket and write/read access only to the backup bucket.
4. Set `R2_BACKUP_BUCKET_NAME`. Optionally set the backup and restore-drill prefixes.
5. Confirm the destination bucket name is different from `R2_BUCKET_NAME`. The command also enforces this boundary.

## Create and verify a snapshot

1. Choose a safe snapshot identifier or allow the command to generate one.
2. Run `npm run backup:protected-media -- --snapshot=SAFE_ID`.
3. Confirm the completion summary reports the expected object count and byte total.
4. Run `npm run verify:protected-media-backup -- --snapshot=SAFE_ID`.
5. Record a passed backup verification only when every object passes the size and SHA-256 check.

The backup command never deletes source or backup objects and refuses an identifier whose private snapshot path already contains data. Use a new identifier for every controlled run; investigate and preserve partial snapshots rather than retrying over them.

## Run an isolated restore drill

1. Select a verified snapshot.
2. Run `npm run drill:protected-media-restore -- --snapshot=SAFE_ID --drill=SAFE_DRILL_ID`.
3. The command copies one backed-up object into the isolated drill prefix, downloads it and checks its SHA-256 value.
4. Record the reported restore evidence reference and duration only when the result is `PASSED`.
5. Retain the drill object until the evidence review is complete; remove it only through the approved retention process.

Drill identifiers are single-use. The command refuses to overwrite an earlier drill path.

## Failure handling

- Stop and preserve the safe error code when configuration, copy, size, metadata or checksum validation fails.
- Do not mark recovery ready, weaken the check or delete the failed snapshot.
- Verify provider access, destination isolation and retention before retrying with a new snapshot identifier.
- Never restore a drill object into the active production bucket.
