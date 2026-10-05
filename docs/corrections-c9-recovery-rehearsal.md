# C9 fictional-data recovery rehearsal

This is a **Draft-only, disposable CI exercise**, not production recovery or launch approval. It does not read a customer database, download a production backup, connect to Render, access R2, run a live player, or satisfy the physical C8 gate.

## Scope

The dedicated GitHub Actions job creates a new PostgreSQL 16 container with a randomly labelled internal network and **no published host ports**. The runner connects only to that exact owned container's inspected private IPv4 at port 5432; its network ID, label, membership, subnet, non-gateway address and unchanged connection are verified. Its data is in temporary memory-backed storage, not a host directory or persistent Docker volume. The script accepts no operator-provided database URL, restore target, archive, credentials, object-store configuration or Docker endpoint. It rejects local execution, self-hosted runners, unexpected repository/event context, extra arguments, inherited database/storage/Render configuration and local `.env` files.

The source is a newly created `ruvanas_c9_recovery_source` database. All repository migrations run **only there**. The migration-created public catalogue and QA configuration are retained. A guarded fixture then adds fictional organisations, facilities, staff grants, supervised Studio versions, render/submission/review history, requests, stored proof and audit records. It does not provision customer access or publish audio.

The job captures a current-run custom-format database dump, records its checksum, creates a **separate new empty** `ruvanas_c9_recovery_target` database, and restores only that archive. Target creation fails if the target already exists; restore uses `--exit-on-error` and `--single-transaction`, without overwrite/clean/create options. Migration names, checksums and applied state must match exactly. Full-row digests preserve the selected fixture models and all catalogue baseline rows; restored relationships and current permission/Studio/review/proof helpers are also checked.

Three synthetic WAV objects are separately copied to private temporary backup files and restored into new files. Each restored object's bytes must match the source SHA-256 and length and the restored database reference. This is a **local-byte backup mechanism test**, not an R2 export, provider restore, or real media-delivery test. The stored completed-proof fixture is synthetic; preserving it does not prove a real broadcast occurred.

## Failure and output controls

Only the current run's exact container ID/name/label, exact network and validated temporary directory may be removed. There is no database drop, broad Docker prune or filesystem sweep. Ownership and network/address boundaries are rechecked before each mutating phase. Database clients are silent; subprocess output and generated connection strings are not printed. Only aggregate result counts, boundary booleans and bounded phase/reason codes are logged. No backup or fixture-content artifacts are uploaded. A failure or incomplete cleanup prevents a passing report; independently owned cleanup steps are still attempted if another fails. GitHub also discards the hosted runner after the job.

Local guard/unit tests can run with `node --test tests/corrections-c9-recovery-rehearsal.test.mjs`. The actual backup/restore command runs only through the dedicated opted-in CI job after dependency/client setup; it must not be adapted to a production connection. The real PostgreSQL roundtrip is accepted only after checking the current commit's `c9-recovery-rehearsal` job result.

## What remains unverified

- Production backups, recovery credentials, media-store export/restore and deployment configuration.
- Customer-approved retention/legal holds, residency, RPO/RTO and operational recovery sign-off.
- A complete independent security review and recovery of every platform model.
- Physical Edge/LAN/TLS/offline playback and delivery evidence (C8).

No new Render resources or paid plans are required. This public repository uses a standard hosted runner; [GitHub documents standard hosted Actions usage as free for public repositories](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). [Docker's internal-network documentation](https://docs.docker.com/reference/cli/docker/network/create/#network-internal-mode---internal) supports host access to the container's private IP while restricting external network access. PostgreSQL's [dump documentation](https://www.postgresql.org/docs/16/app-pgdump.html) warns that restoration executes source-defined code, which is why only the job's own fresh synthetic archive is accepted. Restore controls follow [PostgreSQL 16's pg_restore documentation](https://www.postgresql.org/docs/16/app-pgrestore.html).
