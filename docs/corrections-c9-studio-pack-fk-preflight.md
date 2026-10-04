# C9 Studio programme-pack foreign-key preflight — not executed

**Status: BLOCKED.** This is a read-only preparation aid for migration
`20261205000000_c9_studio_organisation_fk`, not approval to connect to
production, apply migrations, merge PR #218, deploy, or enable Ruvanas Inside.
No production query or migration has been run for this preflight.

## Why the preflight matters

The migration refuses existing `StudioProgrammePack` rows whose
`organisationId` has no matching `Organisation`. It then adds a validated
foreign key. The orphan guard protects data integrity, but it does not measure
table size or the write-blocking time of the validation scan. PostgreSQL notes
that adding a foreign key takes `SHARE ROW EXCLUSIVE` locks on both tables and
that validation of existing rows can block concurrent writes until commit.
See [PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html).

## Read-only checks for an authorised database operator

First confirm the exact database and environment **without printing its
connection string or credentials**. Use a read-only database role where
available. The following queries return schema state and aggregate counts
only; they do not expose pack or organisation records.

Run this first. If either table is absent, stop: the orphan query below is not
applicable yet. Review all earlier pending Inside migrations and the actual
production migration history before planning any rollout.

```sql
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

SELECT
  to_regclass('public."Organisation"') IS NOT NULL AS organisation_table_present,
  to_regclass('public."StudioProgrammePack"') IS NOT NULL AS pack_table_present;

SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = to_regclass('public."StudioProgrammePack"')
  AND conname = 'StudioProgrammePack_organisationId_fkey';

COMMIT;
```

Only if both tables exist, run the aggregate check in a new read-only
transaction. A timeout is an inconclusive result, **not** permission to skip
the check. Record only the counts, database environment, observation time and
operator; do not export row identifiers or customer content into CI or the PR.

```sql
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

SELECT
  count(*) AS pack_rows,
  count(*) FILTER (WHERE organisation."id" IS NULL) AS orphan_pack_rows
FROM public."StudioProgrammePack" AS pack
LEFT JOIN public."Organisation" AS organisation
  ON organisation."id" = pack."organisationId";

COMMIT;
```

An orphan count above zero blocks migration until a separately reviewed,
evidence-preserving reconciliation is authorised. A zero count is a
point-in-time observation; the migration's own guard must still remain in
place. The table size and activity level must inform the lock window. Never
delete or reassign orphan rows merely to make the migration pass.

## Controlled rollout gate — still blocked

Before a future production migration, verify a restorable backup, review the
complete pending migration sequence, rehearse on a production-shaped isolated
database, measure lock duration and application write impact, set suitable
lock/statement timeouts and a quiet window, and obtain the required human
security, database and release approvals. If validation cannot meet the
approved write-interruption budget, design and test a genuinely staged
`NOT VALID` / `VALIDATE CONSTRAINT` rollout. Merely putting both statements in
one migration file is not evidence that the stronger lock is released between
them. Do not change Render Auto-Deploy or run `prisma migrate deploy` as part of
this preflight.

This database gate is only one of the blocked C9 release gates. It does not
waive C8, independent security review, retention/legal hold, residency,
customer identity, recovery or operator acceptance.
