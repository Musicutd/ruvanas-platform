# Stage 13B performance-regression runbook

## Before merge

1. Confirm static integrity, dependency audit, Prisma validation, critical-index assurance, clean migrations, unit tests, production build, route security, release smoke, and performance baseline all pass in the same CI run.
2. Treat a performance failure as release evidence. Do not repeatedly rerun until a noisy result happens to pass.
3. Compare the failing route's p50, p95, maximum, payload size, status, and request attribution with the previous successful run.
4. Determine whether the change is application work, an accidental unbounded query/payload, missing index assurance, or temporary CI-host degradation.
5. Correct or intentionally re-baseline a budget only through a reviewed commit that explains the evidence and trade-off.

## Paid production release

1. Deploy only after the approved pull request and complete CI success.
2. Deploy only the paid `ruvanas-platform` service and keep the free staging service suspended.
3. Confirm the approved commit is live, the build and controlled migration step succeed, and public/login access remains available.
4. Review hosting latency, error rate, CPU, and memory for the changed paths. Do not add customer identifiers, student information, media content, credentials, or full request payloads to metric labels.
5. Compare representative authenticated player state, heartbeat, dashboard/API reads, schedule compilation, proof-ingest lag, and report/export behaviour with the engineering targets. CI access-boundary samples alone do not prove production capacity.

## Regression response

- Roll back an application regression only to a release compatible with the current forward-only schema.
- If response size grew, restore pagination, projections, or aggregate reads instead of raising the budget by default.
- If database latency grew, inspect the actual query plan and tenant filter before adding an index; avoid speculative indexes that increase write cost without measured benefit.
- If heartbeat or proof ingestion degrades, preserve idempotency and offline retry semantics while reducing synchronous work.
- If a third-party stream, storage, notification, or AI provider is slow, preserve the provider boundary and move long work to a bounded job rather than extending request timeouts indefinitely.
- Close the incident only after the paid service is stable, the changed path and one unchanged retail/player path pass, and the free staging service remains suspended.
