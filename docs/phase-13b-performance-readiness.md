# Stage 13B: performance baseline and capacity readiness

Stage 13B turns the master specification's initial performance expectations into repeatable regression evidence. These checks are engineering guardrails, not contractual service-level agreements, and they do not replace production hosting metrics or approved error monitoring.

## CI evidence

- Warm the built application before collecting samples so compilation and start-up are not mistaken for steady-state route latency.
- Collect eight sequential samples for public pages and protected API boundaries.
- Fail when status codes change, API responses lose their request identifier, p95 latency exceeds the route target, or response payloads exceed the bounded size budget.
- Verify the critical indexes that support player heartbeats, proof ingestion, playout intents, job leasing, schedule resolution, and catalogue search.
- Exercise the largest practical weekly schedule and two hundred candidate schedules in deterministic capacity tests.

## Initial targets

| Path class | CI p95 target | Maximum response size |
| --- | ---: | ---: |
| Public page | 1,500 ms | 1,500,000 bytes |
| Authenticated/API read boundary | 500 ms | 64,000 bytes |
| Player state boundary | 300 ms | 32,000 bytes |
| Player heartbeat boundary | 200 ms | 32,000 bytes |

The unauthenticated player/API samples verify the low-cost access boundary and middleware attribution. The existing database-backed integration suite continues to prove the authenticated player, heartbeat, schedule, proof, tenant, and reporting workflows. Production p95 values must be evaluated from hosting metrics under representative load before any external SLA is offered.

## Privacy and operational boundary

The performance smoke suite creates no accounts, players, campaigns, school records, media, notifications, or external deliveries. It does not transmit customer content and does not write to production. Request rate, latency percentiles, process resources, and runtime errors remain in the hosting platform or an explicitly approved monitoring service with bounded labels only.

## No database migration

This stage adds CI tooling, tests, index assertions, and documentation only. It does not change the Prisma schema or rewrite customer data.
