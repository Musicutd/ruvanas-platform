# Expired pilot-access renewal: local release review

Reviewed 19 November 2026. Branch: `codex/rewards-pilot-renewal-local-20261119`. Base: `6c3c4fe6e7f0eb51744c050eb351a0ff0d6ed035`.

## Decision

The local candidate passes release review and is ready for release-commit preparation and full GitHub CI. No blocking application defect was found. The review added populated-database upgrade and restore evidence and this release document; it changed no application source.

This is not deployment clearance or approval to enable Rewards. No commit, public push, production migration, deployment, hosted account access, paid service or encoder action was performed. Rewards and registration settings remain unchanged. Added charges: US$0; the US$15.75/month allowance was not increased or re-estimated.

## Reviewed behaviour

The Super Admin first reviews an exact expired internal trial grant and the prepared shopper's expired membership. Confirmation renews those same records for a fixed end within two hours, preserving their identities, starts-at dates, limits, subscription and history. The shopper stays disabled and the invitation stays revoked. Invitation replacement and user acceptance are separate operations.

Private-pilot scope, current authority, tenant identity, immutable provenance and saved-state fingerprints are rechecked. Updates and audit creation are atomic. Concurrent identical requests return the same outcome; stale or competing requests cannot extend access twice. Revocation, expired authority, disabled gates or a closing test window prevent a partial change.

This is deliberately narrow: it cannot renew paid access or adopt active, credentialed or previously used shoppers. Extra enrolled shoppers, any staff grant or a still-live published offer require separate review. This review did not inspect the current hosted test shop or shopper, so their present eligibility is unverified.

## Evidence

Evidence is stored in workspace `output/retail-rewards-pilot-renewal-release-review-20261119/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Candidate integrity | All 20 input files match the prior tested hashes; no unexpected delta | `input-hash-check.json` |
| Independent backend review | No blocking findings in authorization, recovery scope, locking or retry behaviour | `backend-review.json` |
| Independent interface review | No blocking findings; fresh Node 20 run passed 43/43 checks | `ui-review.json` |
| Populated migration | Applied the new migration after 143 existing migrations and synthetic legacy records; every existing business row and old migration record/checksum was retained | `populated-upgrade-restore-result.json` |
| Logical restore | Unmodified PostgreSQL 16 dump/restore preserved 278 tables, migration history and the new audit event; disabled shopper and absent credentials/sessions verified | Same result and per-run logs |
| Restored constraints | Empty-search-path validator accepts valid evidence, rejects extra secret fields; immutable audit rejects updates/deletes | Same result |

The new migration/restore harness completed 5 check groups on Node v20.20.2 / PostgreSQL 160016. Both databases were newly created synthetic fixtures on loopback. The owned PostgreSQL server is stopped and its port is closed.

The prior implementation's 704/704 Node 20 regression tests, 14/14 PostgreSQL 16 checks, production build and nine compiled disabled-route checks remain applicable because the complete application candidate is byte-for-byte unchanged. Their evidence remains under `output/retail-rewards-pilot-renewal-20261119/`; it was not overwritten or described as a fresh full run. Existing CSS compatibility warnings in unchanged stylesheets did not block that build.

The interface tests use compiled React components and a hook/transport harness. They are not a real-browser, physical-device or hosted-account acceptance test. The restore harness creates renewal-shaped database evidence; the separate prior database suite verifies the actual renewal service and invitation acceptance sequence.

## Migration and rollback

The additive migration creates the new audit enum value, a strict metadata validator and a unique index on organisation/action/request ID. It does not renew any live record or rewrite existing history. Previous service audit writes used null request IDs, which remain supported.

Before any separately authorised hosted migration, run this read-only duplicate preflight and require a zero result:

```sql
SELECT count(*) AS duplicate_groups
FROM (
  SELECT "organisationId", "action", "requestId"
  FROM public."RewardPilotAuditEvent"
  WHERE "requestId" IS NOT NULL
  GROUP BY "organisationId", "action", "requestId"
  HAVING count(*) > 1
) AS duplicates;
```

Historically inserted non-null duplicates would make the new index fail safely. Review a migration adjustment if found; never delete or rewrite audit history to force success. Production data was not queried during this review. Verify an appropriate backup/restore reference before applying the structural migration.

On an application rollback, retain the additive schema and all evidence and keep Rewards disabled. Older strict audit DTOs do not recognise PILOT_ACCESS_RENEWED, so active pilot operation on the old application is not claimed compatible. Do not drop enum values, erase audit records or reverse expiries with ad hoc updates. Before any future deployment, verify the actual hosted baseline and the intended rollback commit.

## Remaining release gates

1. Prepare an exact release commit containing the reviewed source, migration, tests, workflow and documents. Exclude local evidence, database dumps, generated builds and real configuration.
2. Run the full clean-install Node 20/PostgreSQL 16 GitHub workflow on that exact commit, following `docs/runbooks/release-verification.md`. The new dedicated renewal job is configured locally; remote CI has not run for this candidate. Do not bypass failed checks.
3. Obtain a separate deployment request, verify hosted baseline/backup and the duplicate preflight, then deploy only the website while leaving Rewards disabled, registration closed and both encoders unchanged.
4. Before a separately authorised private rehearsal, read the actual shop/shopper eligibility, explicitly bound the attended window and verify real sessions. No account has been renewed or invited by this review.
