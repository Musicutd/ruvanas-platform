# Stage 14A: final retail and School Radio platform acceptance

Stage 14A turns the master build specification's final architecture scenario into one explicit release gate. It does not add customer-facing features or change customer data. It assembles the existing automated evidence into a single controlled acceptance run.

## Acceptance journeys

The database-backed route suite exercises the shared tenant and identity boundary, retail production orders, catalogue and scheduling, campaign publication, player manifests, offline/idempotent proof, reports and exports, governed integrations, School Radio entitlement, safeguarding, guarded student access, supervised editorial work, controlled public podcast publication, immediate withdrawal, academy administration and verified school exchange.

The player lifecycle suite separately proves enrolment, assigned state, reconnect recovery, queued commands, acknowledgement, offline proof replay and disabled-player rejection. Unit and route suites retain the Retail Media, Digital Signage, AudioLab, waveform, multitrack, Show Builder, learning, noticeboard and publication safety contracts developed in the earlier stages.

## One release gate

`npm run test:acceptance` runs, in order:

1. the complete database-backed route and player lifecycle integration suite;
2. the non-destructive release regression smoke; and
3. the performance and capacity baseline.

Failure stops the gate and prevents release. CI continues to run unit tests, schema validation, migrations, protected-media checks and the production build before this final gate.

## Production safety boundary

The acceptance runner refuses to start unless both the application and database use loopback hosts and `RUN_DATABASE_TESTS=1` is explicitly set. It cannot be pointed at the paid Ruvanas service or its production database. The free staging service remains suspended.

The acceptance fixtures use generated identities and records on the disposable CI database. They do not use customer, school, student or production data, and the smoke/performance stages do not contact external providers.

## Stage 14A exit criteria

- Unit tests, migrations, production build and the final acceptance gate pass in CI.
- The final retail and School Radio architecture scenarios remain supported without separate product forks.
- Tenant isolation, capability boundaries, safeguarding, consent and public-response redaction remain enforced.
- Player and signage delivery evidence is never described as listeners, viewers, reach or commercial causality.
- Only the paid `ruvanas-platform` service may be deployed after approval; the free staging service stays suspended.
