# Stage 19.26 — Enterprise and Scale Readiness

## Outcome

Stage 19.26 closes the Online Radio roadmap with a fail-closed, super-admin-only readiness control surface. It combines the existing platform-health, tenant, player, listener-session, failover and performance foundations into one enterprise expansion decision. It does not create a parallel platform, change live playout, select a streaming vendor or promise contractual capacity.

## Enterprise control surface

`/admin/enterprise-scale` provides:

- privacy-safe platform totals for organisations, stations, channels, enrolled players, current listener leases and managed media;
- explicit engineering warning thresholds and hard review guardrails;
- internal continuity objectives for observed availability, manifest response, errors, continuity gaps and failover recovery;
- the latest current result for tenant-isolation, representative capacity, 24-hour soak and controlled failover evidence;
- append-only evidence recording through the existing audit log.

Only `SUPER_ADMIN` may read or record this evidence. Fleet counts are aggregate and the response excludes organisation names, customer identities, content, listening histories, raw infrastructure identifiers and credentials. Evidence is environment-bound to the paid `ruvanas-platform` service.

## Readiness policy

The status is `BLOCKED` unless all four evidence gates have a current `PASS` result and platform health has no critical finding. Approaching a capacity guardrail or a non-critical platform-health finding produces `ATTENTION`. `READY_FOR_CONTROLLED_SCALE` is an internal engineering decision only; it is not a commercial SLA or regulatory certification.

Evidence validity and minimum acceptance rules are deterministic:

| Evidence | Maximum age | Minimum acceptance |
| --- | ---: | --- |
| Tenant-isolation review | 90 days | At least one tenant-scoped route tested and zero cross-tenant leaks |
| Capacity baseline | 30 days | At least 100 samples, current fleet/listener demand represented, manifest p95 at most 500 ms and errors at most 1% |
| Continuity soak | 30 days | At least 24 hours and 100 samples, availability at least 99.9%, errors at most 1% and gaps at most 30 seconds |
| Failover drill | 90 days | Recovery at most 300 seconds and continuity gap at most 30 seconds |

A new failed or incomplete result supersedes an older passing result for that evidence type. Stale evidence blocks readiness automatically.

## Capacity and partitioning boundary

The displayed limits are conservative application guardrails designed to force review before the system reaches an untested shape. They do not claim that the current hosting topology has been load-tested to every hard limit. Expansion beyond a guardrail requires new representative evidence, database/index review, streaming-provider capacity confirmation and an approved operational change.

Existing ownership keys, organisation-scoped authorisation, station/channel composite references, listener-session capacity leases and immutable audit records remain authoritative. This stage adds no schema and rewrites no customer data.

## Safe test tooling

`npm run probe:enterprise-scale` samples the protected player boundary with bounded concurrency. It is restricted to a local application instance, requires 100–10,000 samples and caps concurrency at 20. It cannot target the paid service, mutate customer data or constitute the required 24-hour soak by itself. A real capacity or soak report must be produced in an approved disposable environment and retained under the reference recorded in the workspace.

## Acceptance and rollback

- Unit tests cover complete, missing, stale, failed and undersized evidence; wrong-environment and hard-capacity blockers; and the local-only probe boundary.
- Static tests prove super-admin access, aggregate fleet queries, append-only evidence and the absence of live playout writes.
- The full retail, School Radio and Online Radio regression suite, Prisma validation, static integrity checks and production build remain mandatory.
- Rollback removes the page, API and policy modules. Audit entries may remain as operational evidence because no new database structure or live-state mutation is introduced.
