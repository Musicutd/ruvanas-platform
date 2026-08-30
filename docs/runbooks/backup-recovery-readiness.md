# Stage 12D backup and recovery runbook

## Safety boundary

Use this runbook only for the paid Ruvanas production service and its approved database and protected-storage resources. Keep the free staging web service suspended. Never paste passwords, connection strings, access keys, signed URLs, customer content, media, student data, or full provider console links into Ruvanas evidence fields.

## Confirm a recovery control

1. Open **Super Admin → Backup & recovery** and confirm the displayed environment is the intended paid production environment.
2. Inspect the authoritative provider settings without copying secrets.
3. For the database, confirm automated backup coverage and retention. For protected storage, confirm versioning or an approved backup recovery strategy.
4. Record RPO and RTO targets only after the available provider capabilities and operating procedure have been confirmed.
5. Enter a short operational note describing the check and save the control.
6. If any setting is uncertain, leave it unconfirmed. Do not mark readiness to remove a warning.

## Record a backup verification

1. Verify the provider backup or version exists and is accessible to the authorised operator.
2. Record a safe internal reference, the verification time, and—when known—the source capture time.
3. Mark **Passed** only when the evidence has been checked. Use **Partial** for incomplete coverage and **Failed** when it is unavailable or invalid.
4. If verification fails, preserve the record, stop risky releases, and resolve the provider or storage issue before recording a new result.

## Run a restore drill

1. Use an isolated, authorised recovery target. Never overwrite the active production database or protected objects as a drill.
2. Restore the selected backup or version and record start/end times.
3. Validate authentication data relationships, tenant isolation, schedules, player configuration, protected-object access, jobs, and audit evidence appropriate to the restored asset.
4. Record the safe evidence reference, source capture time, total restore duration, and result.
5. If the drill misses RPO or RTO, preserve the result and open a corrective operational action. Do not change the target solely to hide the miss.

## Migration or release incident

1. Stop application writes and background workers when data integrity may be at risk.
2. Preserve the failed migration output and the pre-migration snapshot reference.
3. Roll back application code only when it remains compatible with the additive schema.
4. Restore from the verified snapshot only through the authorised provider procedure and only after the exact target has been checked.
5. Verify authentication, tenant isolation, player manifests, jobs, proof ingestion, and both operational dashboards before reopening writes.
6. Record the incident and subsequent verification or restore-drill evidence. Never edit an already-applied migration.

## Quarterly review

Review both recovery controls and complete isolated restore drills at least every 90 days once production customers depend on Ruvanas. Update controls when the hosting plan, storage provider, retention, regions, or operating procedure changes.
