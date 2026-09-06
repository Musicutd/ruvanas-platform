# Stage 19.16 — Podcasts

## Outcome

Stage 19.16 adds professional, station-scoped podcast publishing to Online Radio. An organisation can create a series, select currently approved station audio, prepare episode metadata, chapters and an optional reviewed transcript, then publish a branded listening page and standards-based RSS feed.

The implementation generalises the proven School Radio series, episode, transcript, chapter and protected-audio primitives. It does not create a second podcast subsystem. A product discriminator and policy adapters keep Online Radio publication separate while all School Radio safeguarding, consent, staff approval and withdrawal behaviour remains intact.

## Subscriber journey

1. Open **Online Radio → Podcasts**.
2. Create a station-owned series and optional channel link.
3. Select audio whose current Media Library version has passed Ruvanas review.
4. Add episode metadata, accessible description, chapters and optional transcript.
5. A manager approves a submitted transcript when one exists and publishes the episode.
6. Share the branded public page or RSS address.

Editing a published episode withdraws it automatically so a manager must review and publish the new version again.

## Governance and security

- The active organisation comes only from the authenticated session; request bodies cannot choose another tenant.
- Series-to-station, series-to-channel and episode-to-media ownership are protected by composite database foreign keys as well as route checks.
- Content roles may create and edit drafts; only owner/manager roles may approve transcripts, publish or unpublish.
- Public queries require an active service, an Online Radio series, a public RSS-enabled series, a usable station and a currently approved audio version.
- Public projection never exposes storage keys, user records, tenant IDs or approval internals.
- Audio supports browser and podcast-client byte ranges through the shared protected podcast delivery helper.
- School Radio queries explicitly select the School policy adapter, preventing Online Radio episodes from entering school publishing, safeguarding or readiness reports.

## Public interfaces

- Branded page: `/podcasts/{organisationSlug}/{feedSlug}`
- Safe JSON feed: `/api/public/podcasts/{organisationSlug}/{feedSlug}`
- RSS: `/api/public/podcasts/{organisationSlug}/{feedSlug}/rss`
- Protected episode audio: `/api/public/podcasts/{organisationSlug}/{feedSlug}/episodes/{episodeId}/audio`

## Validation matrix

- Unit: slug normalization, chapter/transcript bounds, fail-closed publication and safe public projection.
- RSS: absolute enclosure URLs, XML escaping, duration/explicit metadata and no storage-key leakage.
- Integration/static: active tenant derivation, manager publication gate, current audio approval, composite ownership constraints and School policy isolation.
- Regression: School Radio continues through the shared core with its original safeguarding adapter.
- Performance: a full 200-episode feed renders within a bounded budget and database list paths are indexed.

## Migration and rollback

The migration is additive except for broadening the existing School episode link to optional and replacing the series-title unique key with a product-aware key. All existing rows default to `SCHOOL_RADIO`, so their behaviour is preserved. Rollback should first unpublish Online Radio feeds, then retain episode/audit data while application access is removed. Destructive column or enum removal requires a separate data-retention review.
