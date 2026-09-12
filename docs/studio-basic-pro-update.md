# Ruvanas Studio Basic + Pro — local implementation record

## STP.0 architecture and dependency audit

The existing main-line architecture already contained Studio A–G, `AudioProject` / `AudioProjectVersion`, immutable `MediaAsset` / `AudioTake` sources, non-destructive waveform editing, multitrack editing, the protected audio worker, AutoDJ, scheduler/playout foundations, browser live controls, managed stream configuration, product handoffs, rights controls, Product QA, and all six product families with thirty public plans.

This update reuses those foundations. It does not create a second editor, renderer, media library, scheduler, streaming platform, rights engine, or product system. The shared subscriber entry point remains `/dashboard/studio`; the existing School-prefixed internal routes and upload tables are retained for migration compatibility but now authorize the active organisation through the shared Studio entitlement guard.

## Roadmap result

- **STP.1:** one `studioLevel` authority derives Basic for Tier 1–2 and Pro for Tier 3–5 across Retail, School, Online, Health, Faith, and Organisations. Basic is limited to eight tracks; Pro is limited to sixteen. No plan-code substring checks are used.
- **STP.2:** `/dashboard/studio` is now the shared Studio hub with Create & edit, Manual Playout, Broadcast, and Production service workspaces.
- **STP.3:** Studio Basic retains recording, recovery, non-destructive waveform editing, voice cleanup, curated presets, mastering, versioning, server render, and the simplified eight-track multitrack workflow. Pro-only state is hidden and rejected server-side.
- **STP.4:** Waveform Pro exposes dedicated Select/Blade controls, exact splits and boundaries, draggable fades, clipboard edits, ripple/gap behaviour, gain, markers/regions, history, zoom, Fit Project/Selection, and shortcuts.
- **STP.5:** Multitrack Pro exposes timeline snapping, Fit Project/Selection, draggable edge trims and fades, 16-track mixing, Track Gain, Clip Gain, pan, mute/solo/arm/lock, crossfades, automation, ducking, gain warnings, and server mastering.
- **STP.6:** Manual Playout stores its live queue, prepare area, commands, revisions, locks, modes, and fallback state on the server. Empty or ended manual queues return to AutoDJ instead of producing intentional dead air.
- **STP.7:** the three-area playout workspace separates Live Playlist, Prepare, and Library. It shows Now Playing progress, elapsed/remaining time, estimated starts and runtime; supports direct drag to Live or Prepare; and keeps local preview isolated from public output.
- **STP.8:** the runtime respects the existing scheduler/AutoDJ authority. Active scheduled intents take priority while preserving the manual queue, and fallback is server controlled.
- **STP.8A:** Quick Connect reuses managed Ruvanas station configuration. External Icecast/SHOUTcast profiles store encrypted, write-only credentials. Tier caps are 2/5/10 external destinations for Tiers 3/4/5, with an optional configured Tier 5 plan override. Connections and reconnects are owned by the operations worker, not the browser.
- **STP.9:** Programme Packs reference protected media by intro, outro, jingle, bed, promo, prerecorded segment, interview and recurring-feature roles without duplicating source files. The Library separates the requested media types.
- **STP.10:** shared subscriber theming, responsive layout, and product-aware operating/safety language are reused for every product family.
- **STP.11:** all routes derive tenant, role, plan, Studio level, catalogue availability, and destination ownership server-side. Live commands use idempotency keys and optimistic revisions. Listener counts remain unavailable unless returned as trusted provider telemetry. Legacy Pro project data is preserved read-only after downgrade; active playout falls back and active external distribution ends safely.
- **STP.12:** automated Studio, regression, catalogue, plan, product-isolation, schema, static, and production-build checks are recorded below.

## Product and rights boundaries

Ruvanas supplies the technology; each subscriber operates and approves its service. School retains safeguarding and staff supervision. Health retains clinical approval and receives no clinical content or advice from Ruvanas. Faith retains ministry approval and receives no doctrine or religious content from Ruvanas. Catalogue access remains a separate entitlement and every catalogue source is rechecked server-side before it can enter a saved project, Programme Pack, or live queue.

## Persistence and migration

Migration `20261114000000_studio_basic_pro_update` adds server-owned playout sessions/items/commands, Programme Packs/items, broadcast destinations/sessions/session links/commands, broadcast state enums, and the optional `Plan.studioExternalDestinationLimit` override. Existing project, version, source media, AutoDJ, station, stream, render, approval, rights, and product-handoff records are reused.

## Validation evidence

- Prisma schema format and validation: passed with a disposable validation URL.
- Prisma client generation: passed.
- Studio suite: 40/40 passed.
- Full unit/regression suite: 737 passed, 8 environment-dependent tests skipped, 0 failed.
- Organisations dependency suite: 6/6 passed.
- Product registration/isolation suite: 35/35 passed.
- Static integrity check: passed across 1,150 files.
- Next.js production build: passed, including type and route compilation.
- Live integration suite: not executed successfully because this local workspace has no disposable PostgreSQL database, `SESSION_SECRET`, or application server on port 3100. The failures were environment connection/configuration failures, not assertion failures.

## Deployment limitation and release gate

Managed Ruvanas Quick Connect can use the existing station stream provider. External Icecast/SHOUTcast delivery is deliberately reported as unavailable until `STUDIO_BROADCAST_PROVIDER_URL` and `STUDIO_BROADCAST_PROVIDER_TOKEN` point to compatible server-side encoder/distribution infrastructure. Saving an encrypted profile does not falsely claim that an external encoder exists.

The source is locally safe to publish for review after a final diff review. Production release must still apply the migration, configure the external provider only where supported, run the disposable-database integration suite, and verify paid-service worker health. This local task does not publish, merge, migrate a live database, or deploy.
