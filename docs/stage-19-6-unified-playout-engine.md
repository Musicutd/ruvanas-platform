# Stage 19.6 — Unified Playout Engine

## Outcome

Stage 19.6 introduces one deterministic playout decision for every enrolled player request. Published Advanced Scheduler programmes, protected School Radio programmes, Retail schedules and Continuous AutoDJ now enter the same priority resolver before the existing manifest, synchronized live clock and proof-of-play systems are used.

This stage does not create a second player, scheduler, media library or campaign engine. It is an orchestration layer over the governed sources already delivered.

## Authoritative source order

The resolver uses an explicit, stable order:

1. emergency override;
2. authenticated live session;
3. protected School Radio programming;
4. published Advanced Scheduler programming;
5. zone Retail schedule;
6. location Retail schedule;
7. default Continuous AutoDJ;
8. backup Continuous AutoDJ.

Emergency and live candidates are reserved extension points for Stages 19.7–19.9. Stage 19.6 does not pretend that an external live source exists before its health and access controls are built.

## Source adapters

- A published Advanced Scheduler Music Mode becomes a playable scheduled source after the existing rights and media-readiness checks pass.
- A published Radio Clock can play its current Music Mode or individual music track. Other timed item types fail over with an explicit adapter-unavailable reason until their governed delivery adapter is added.
- An approved Show Builder rundown can play its current music-track item. Voice, interview, jingle and announcement items fail over explicitly rather than bypassing School Radio safeguards or proof-of-play verification.
- Existing zone and location Music Schedules retain their established targeting and opening-hours behavior.
- Default and backup AutoDJ modes are evaluated separately, so a missing default produces an explainable backup decision.
- Campaign and approved School Radio insertions remain compiled by their existing engines, are conflict-resolved once and are attached to the selected decision in deterministic order.

## Decision and evidence contract

Each decision contains:

- a deterministic 64-character decision ID for the five-minute decision window;
- selected source type, stable source ID and revision;
- applied priority and proof classification;
- validity and next-decision timestamps;
- the complete evaluated fallback chain and safe unavailability reasons;
- required insertion IDs;
- a warning when a higher-priority source failed over, or a critical alert when no source is playable.

The player manifest exposes only this bounded evidence. Runtime source payloads, storage keys and internal media details are never serialized. Manifest versions react to authoritative source revisions while players on the same channel keep the same synchronized rotation.

## Security and operational behavior

- Candidate organisation and channel boundaries fail closed.
- Published/active source state is rechecked when the player manifest is requested.
- Rights and media eligibility continue to use the shared library rules.
- Proof-of-play accepts the three new Advanced Scheduler source classifications only when the existing player-bound signature verifies.
- Fallback and critical decisions enter the existing in-app notification and audit path with the decision ID for correlation.
- No database migration or destructive data rewrite is required.

## Verification

- Unit coverage exercises every currently available priority path, deterministic decision IDs, insertion ordering, fail-closed tenancy and critical no-source behavior.
- Manifest coverage verifies safe evidence serialization, source revision invalidation and cross-player channel synchronization.
- Advanced Scheduler, Retail scheduling, AutoDJ, campaigns and School Radio regression suites remain part of the focused gate.
- The focused playout and regression gate passes all 58 checks.
- The full regression gate passes: 486 tests, 478 passed and 8 environment-dependent database checks intentionally skipped.
- Static integrity passes across 812 checked files and all 15 required performance-index directives are present.
- A 10,000-candidate decision resolves in approximately 0.24 seconds on the verification machine, below the one-second request budget.
- The built application passes the seven-route performance smoke gate, including public pages and authenticated player/operations boundaries.
- The production build completes successfully. Local static generation reports the expected missing `DATABASE_URL` diagnostics for database-backed pages while still completing with exit code 0.

## Deliberate next boundary

Stage 19.7 may add provider-neutral external live candidates. Stage 19.8 adds time-bounded DJ authority, and Stage 19.9 adds health-driven failover. Those stages must feed this resolver instead of adding parallel playout logic.
