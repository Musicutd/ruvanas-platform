# Stage 19.0 — Online Radio architecture and reuse audit

## Status and scope

- **Audit date:** 2026-09-04
- **Authoritative baseline:** `origin/main` at `08ac638` (`Stage 18N product onboarding`)
- **Change type:** documentation only
- **Application behaviour:** unchanged
- **Database migrations:** none
- **Deployment configuration:** unchanged

This audit treats the latest `main` branch as the production architecture. Pull request #99 / commit `8ee8647` (the proposed Stage 19A Continuous AutoDJ work) is intentionally **not** part of the baseline because it has not been merged into `main`. Its design is reviewed as pending work, not described as production behaviour.

## Executive conclusion

Ruvanas is already a mature multi-product platform. Online Radio should become a product-policy layer over the existing shared identity, tenancy, entitlement, media, Studio, programming, playout, campaign, podcast, analytics, notification, integration and operations systems.

The safest ownership boundary is:

- `Organisation` owns commercial access, people, media, rights, shared production resources and networks.
- `Station` is the public Online Radio service identity and the boundary for public branding, audience, distribution and provider-facing capacity.
- `Channel` is the authoritative programme/audio service within a station and should own programming-source selection, AutoDJ, clocks and live priority policy.
- `StreamSource` should become a provider-neutral input/output endpoint abstraction when multiple live, relay and distribution sources are introduced. The existing one-to-one `StationStreamConfig` should remain supported as a compatibility adapter.
- `Player` remains an enrolled playback endpoint, not a station, listener or stream source.
- `MusicMode` remains a reusable weighted music profile and should not be renamed to playlist.

The main architectural risk is not missing infrastructure; it is creating parallel Online Radio versions of infrastructure that already exists. Stage 19 must centralise decisions in a shared playout resolver and add product policies around it.

## Repository evidence reviewed

The audit covered:

- `prisma/schema.prisma` and every migration under `prisma/migrations/`.
- Online Radio subscriber pages, station creation and station stream setup.
- `lib/music-scheduling.mjs`, `lib/player-programming.js`, `lib/player-manifest.mjs`, `lib/live-channel-clock.mjs`, opening-hours logic and subscriber programming routes.
- campaign compilation, School Radio insertion merging, playout intents and proof-of-play ingestion.
- `MediaAsset`, `Track`, catalogue rights checks and protected media delivery.
- Production Orders, AudioLab, waveform editing, Show Builder, multitrack state and the FFmpeg/FFprobe audio worker.
- School podcast, transcript, chapter, public publication and audio-delivery paths.
- School live sessions, station stream health, player leases and synchronized browser playout.
- authentication, active-organisation context, roles, entitlements, complimentary access, jobs, notifications, API credentials, webhooks, analytics, billing, audit and recovery.
- current test inventory and `.github/workflows/ci.yml`.

## Current Online Radio architecture

### Service and tenant layer

Online Radio uses the same authenticated `User`, `Organisation`, `OrganisationMember`, `Plan`, `Subscription` and complimentary-access flow as Retail and School Radio. Subscriber requests derive the active organisation from the authenticated session. Platform administration uses `SUPER_ADMIN` / `SUPPORT`; tenant work uses `OWNER`, `MANAGER`, `CONTENT_EDITOR` and `VIEWER`.

Entitlements are resolved centrally by `lib/entitlements.mjs`. Today `stationLimit` also drives `streamLimit`; listener and storage limits are plan-derived and copied to a station at creation. This is adequate for the current service but should eventually separate station count, concurrent broadcast outputs, public listener concurrency and enrolled player concurrency.

### Station and stream layer

`Station` is an organisation-owned Online Radio identity with a globally unique slug, public presentation fields, status and capacity snapshots. `StationStreamConfig` is a one-to-one provider configuration that stores a public stream URL, encrypted source credentials, codec settings, a backup URL and health-probe settings.

Station creation is tenant-managed through `/api/stations`; sensitive streaming setup is platform-admin managed through `/api/stations/[stationId]/setup`. `/api/public/stations/[slug]` exposes only active station identity and the public stream URL.

The current provider configuration is intentionally provider-neutral in health monitoring (`providerKey`) but structurally remains a single station-level configuration. It cannot yet represent several concurrent inputs, scheduled relays, master live, per-channel outputs or a distribution fan-out graph.

### Programming layer

`MusicMode` is an organisation-owned weighted set of `Track` records. `MusicSchedule` is versioned, publishable and attached to a `Location` or `Zone`; its `ScheduleSlot` rows select one active `MusicMode` for a weekday/time window. `lib/music-scheduling.mjs` validates non-overlap, handles overnight slots and resolves zone specificity before location specificity.

This is a strong reusable scheduling foundation, but its ownership vocabulary is currently retail-oriented. An Online Radio station/channel must not be forced to create synthetic retail locations indefinitely. The resolver should accept a common scheduling target abstraction while preserving existing location/zone records and routes.

### Playout layer

`lib/player-programming.js` is the current orchestration point. It loads music schedules, campaigns and approved School Radio slots, resolves opening hours, compiles insertions, records `PlayoutIntent` rows and returns a programming result.

`lib/player-manifest.mjs` turns the result into a signed five-minute manifest. It uses deterministic weighted rotation and `lib/live-channel-clock.mjs` to produce a shared channel clock with two-second crossfades. `app/player/LiveChannelPlayer.js` joins the clock at the current position, preloads the incoming item and maintains two audio elements for overlap.

Campaign and School Radio insertions are compiled separately, then merged by shared priority/gap rules. Proof events are signed and persisted with immutable display snapshots and optional campaign, school, track, channel and intent references.

Current limitation: when no published schedule slot resolves, `main` returns a no-programming state. Continuous AutoDJ default/backup selection exists only in the unmerged Stage 19A proposal.

### Media, Studio and processing layer

`MediaAsset` is already the shared protected binary object. It supports organisation-owned and Ruvanas catalogue libraries and is referenced by tracks, promos, Studio takes/clips/renders, transcripts, School Radio content, proof and playout intents.

Studio infrastructure already includes:

- `ProductionOrder` collaboration and file/revision workflows;
- `AudioProject` and versioned edit decisions;
- AudioLab recording/upload sessions;
- waveform peaks and non-destructive editing;
- multitrack `AudioTrack` / `AudioClip` timelines;
- voice, music and effect track kinds;
- Show Builder transitions and rundowns;
- queued `AudioRender` processing;
- FFmpeg/FFprobe-based audio worker, loudness analysis and render presets.

Online Radio must expose/generalise these systems rather than introduce a second editor or upload pipeline.

### Podcast, newsroom and live layer

School Radio already provides series, episodes, chapters, transcripts, controlled publication, public listing/audio delivery, newsroom stories and scheduled `LiveStudioSession` records with soundcheck, quality, go-live token, recording and automatic fallback concepts.

Safeguarding policy is deliberately School-specific. The media, series/episode, transcript, chapter, audio-delivery and live-session mechanics are reusable. The safe route is a shared podcast/live core with School Radio policy attached, not direct reuse of school-named models by Online Radio forever and not a duplicated Online Radio stack.

### Platform operations

The platform already provides tenant-aware audit logs, idempotent background jobs, in-app/external notifications, service accounts and API keys, outgoing webhook retries, integration metrics, hourly operational aggregates, stream health incidents, billing reconciliation, support, compliance and backup/recovery controls. These are shared core services.

## Canonical terminology review

| Term | Current meaning | Current model(s) | Current routes/services | Subscriber-visible meaning | Recommended long-term meaning | Change needed / safest strategy |
| --- | --- | --- | --- | --- | --- | --- |
| **Station** | Organisation-owned Online Radio service identity with public slug, plan capacity and one stream configuration. | `Station`, `StationStreamConfig`, stream-health models | `/api/stations`, `/api/admin/stations`, `/api/stations/[stationId]/setup`, `/api/public/stations/[slug]`, station pages | The named online station customers create and open. | Public brand/service and audience/distribution boundary. A station contains one or more channels and public products. | Keep model/name. Add services around it. Do not move programme selection into `StationStreamConfig` or rename the table. |
| **Channel** | Organisation-owned programme/audio route, optionally attached to a station and assigned to zones; linked to proof, playout intents and live sessions. | `Channel`, `ChannelAssignment` | admin channel routes; player/programming resolver; School live session routes | A Ruvanas channel assigned to a shop/zone; not yet clearly exposed as an Online Radio channel. | Authoritative logical audio service inside a station. Own source priority, AutoDJ, clocks and live policy. | No rename. Introduce a `ChannelProgrammingService` / `PlayoutResolver` abstraction and gradually make Online Radio channel ownership explicit. |
| **Stream Source** | Today this phrase mixes the station's public output URL, source credentials and provider health. | `StationStreamConfig`, stream-health samples/incidents | station setup, admin probe/health APIs, `lib/stream-source-health.mjs` | The connected streaming provider or URL. | A provider-neutral endpoint/input with purpose (`LIVE_INPUT`, `RELAY_INPUT`, `PUBLIC_OUTPUT`, `BACKUP`) and health/failover state. | Add a new model later when multiple sources are needed. Keep `StationStreamConfig` as a compatibility adapter; do not rename it in place. |
| **Player** | Enrolled, zone-bound playback endpoint with device identity, heartbeat, command, listener lease and proof. | `Player`, `PlayerListenerLease`, command/health models | `/api/player/*`, `/api/player-setup`, subscriber/admin player pages | A secured shop/school/web playback device. | Managed playback endpoint. It consumes a channel manifest; it is neither a public listener nor a broadcast source. | Keep model/name. Add a separate public listener session/event system rather than overloading player leases. |
| **Music Mode** | Organisation-owned weighted group of approved tracks, used by schedule slots and deterministic rotation. | `MusicMode`, `MusicModeTrack` | admin/subscriber programming APIs and pages; manifest builder | A reusable sound/profile used in a schedule. | Reusable music policy/rotation profile. Smart playlists may feed it or coexist, but a mode remains a policy rather than a static playlist. | Keep model/name. Add aliases in UI where helpful (“rotation profile”), not a database rename. Generalise playable-media eligibility. |

## Reuse matrix

| Stage 19 domain | Existing Ruvanas capability | Reuse | Generalise | New development | Risk |
| --- | --- | --- | --- | --- | --- |
| AutoDJ | Music modes, weighted deterministic rotation, synchronized clock, manifest refresh | Rotation, media eligibility, proof, player | Channel-owned fallback policy and source evidence | Default/backup policy and coverage preview | Medium |
| Media library | `MediaAsset`, `Track`, genres, protected media, catalogue rights, uploads | Storage, delivery, metadata, security | One eligibility service for catalogue and organisation music | Advanced search, bulk metadata, dedupe, cue points | Medium |
| Smart playlists | Track metadata, genres, music-mode weights | Track query and rights checks | Saved rule evaluation feeding rotations | Rule model, explainable preview, materialisation | Medium |
| Rotations | `MusicMode`, weighted deterministic order | Existing algorithm and mode ownership | Separation rules/history-aware selection | Rotation constraints and history state | Medium |
| Radio clocks | Schedule slots and Show Builder item transitions | Time validation, item source types, transitions | Shared clock-item vocabulary | Clock/template models and resolver | Medium |
| Scheduling | Versioned `MusicSchedule`, `ScheduleSlot`, timezone/opening hours | Validation, publication, precedence | Common target (`channel` in addition to location/zone) | Programme/clock/live/relay slot types | High |
| Playout priority | Player orchestration, campaign and school insertion merge | Manifest/proof/intent pipeline | One explicit authoritative resolver | Priority graph and decision evidence | High |
| External Live | Stream config, health probes, School live sessions | Endpoint validation, health incidents, tokens | Provider-neutral live source/session | Ingest adapters, source authorisation | External Dependency |
| DJ access | Organisation membership and live go-live token | Auth, tenancy, audit, session security | Capability grants scoped to station/channel/show | Presenter/DJ assignments and ephemeral credentials | High |
| Live failover | Backup URL, probes, automatic School fallback | Health, incidents, notifications | Source failover state machine | Multi-source policy, switch evidence | High |
| Browser Live Studio | School live lifecycle, Studio recording, media storage | Soundcheck, token, recording, fallback | Generic live-session core | WebRTC/ingest client, mix-minus, monitoring | External Dependency |
| Voice tracking | Audio projects, takes, markers, Show Builder | Recording, editing, renders | Link produced segments to clocks/programmes | Voice-track placement workflow | Medium |
| Segue editing | Waveform/multitrack fades and two-player crossfade | Editor primitives and playback preview | Shared cue/transition metadata | Per-track intro/outro/cue and segue editor UI | Medium |
| Audio processing | FFmpeg/FFprobe worker, loudness report, render presets | Worker and protected storage | Broadcast processing profiles | Normalisation policy, limiter, QC lifecycle | Medium |
| Listener analytics | Player leases, heartbeats, hourly operational aggregates | Aggregation/jobs/API patterns | Separate public-listener semantics | Listener event/session schema, privacy controls | High |
| Public player | Public station lookup and current browser player components | Station identity, audio UI, now-playing/proof patterns | Anonymous public delivery boundary | Embeddable player, metadata, capacity enforcement | High |
| Listener interactions | Notifications/support patterns only | Moderation/audit/job patterns | Reusable governed submission workflow | Requests, dedupe, abuse controls, consent | High |
| Podcasting | School series/episodes, chapters, transcript, public audio | Media, publication, transcripts, delivery | Shared podcast core with School policy adapter | General series/feed ownership and RSS | Medium |
| Website | Public homepage and public school/station routes | Auth-free delivery conventions, branding fields | Station public-profile service | Themes, pages, now-playing, SEO/domain support | Medium |
| Mobile/PWA | Responsive Next.js UI; no service worker/native shell found | Web routes and API | Offline-safe public/player APIs | Manifest, service worker, installability, push | External Dependency |
| Station networks | School network/membership/exchange | Membership, agreements, audit | Shared network ownership/policy concepts | Station network and channel affiliation models | High |
| Syndication | Verified School episode exchange | Offer/request/approval patterns | Generic content/feed agreement workflow | Live/recorded relay contracts and rights windows | High |
| Advertising | Campaigns, targets, rules, schedules, promos, Retail Media, proof | Entire campaign/proof core | Target channels/stations/audiences and inventory | Radio ad breaks, pacing, booking/traffic interfaces | High |
| Rights reporting | Track rights, territory/expiry, proof and report exports | Rights metadata and evidence | Product-neutral usage ledger | Authority-specific exports and reconciliation | External Dependency |
| Distribution | Station public URL and integration/webhook platform | API keys, webhooks, retries, health | Distribution destination adapter contract | Directory/CDN/app/assistant connectors | External Dependency |
| AI | Governed AI jobs, provider policy, review and provenance | Governance, jobs, human approval | New assistant types using same controls | Programme-director recommendations and provider adapters | External Dependency |
| Newsroom | School stories, assignments, sources, fact-check and review | Editorial lifecycle and Studio | Shared newsroom core with School policy | Online Radio roles, wire/import and publication destinations | Medium |

## Forbidden Duplication Map

The following are architectural constraints, supported by repository evidence:

1. **No second audio upload/storage pipeline.** Use `MediaAsset`, existing protected delivery, multipart upload patterns and storage adapters.
2. **No second authentication or session system.** Use the current session, password recovery, active-organisation and enterprise identity architecture.
3. **No second tenant or organisation-role system.** Extend capabilities over `OrganisationMember`; do not add Online Radio-specific global roles.
4. **No second entitlement/billing engine.** Extend `Plan`, `Subscription`, `resolveEntitlements` and complimentary access deliberately.
5. **No second track/rights catalogue.** Generalise `Track`, `MediaAsset`, genre and licence eligibility services.
6. **No second player identity, command or health system.** Enrolled endpoints continue using `Player`; anonymous listeners receive a distinct lightweight audience session model.
7. **No second manifest/proof pipeline.** Extend `resolvePlayerProgramming`, manifest compilation, proof tokens, `PlayoutIntent` and `ProofOfPlayEvent`.
8. **No separate Online Radio campaign engine.** Generalise `Campaign`, targets, rules, schedules, promos, Retail Media inventory and proof.
9. **No completely separate podcast stack.** Extract shared podcast services/models from the School implementation while retaining safeguarding adapters.
10. **No second waveform or multitrack editor.** Reuse `AudioProject`, waveform editor, `AudioTrack`, `AudioClip`, markers and renders.
11. **No second audio worker.** Extend the existing job/FFmpeg/FFprobe worker with bounded processing profiles.
12. **No second notification queue or job runner.** Use `Job`, notification events/deliveries and operations workers.
13. **No second webhook/integration platform.** Add event types and adapters to the existing service-account, API-key and outgoing-webhook architecture.
14. **No second AI governance system.** New Online Radio assistants must use `AIJob`, provider policy, provenance and human review.
15. **No duplicate analytics truth.** Operational, listener, advertising and rights projections must derive from immutable event streams and shared aggregation jobs.
16. **No in-place renaming of production tables to solve vocabulary.** Prefer aliases and service abstractions, followed by additive migrations only where a genuinely new concept exists.

## Proposed shared architecture

### Shared Ruvanas Core

| Core domain | Existing anchor | Safe extension point |
| --- | --- | --- |
| Identity | `User`, `Session`, recovery, enterprise identity | Product-neutral capability grants and presenter profiles |
| Tenancy | `Organisation`, membership, active context | Station/channel scoped assignments validated inside the active organisation |
| Billing | Plans, subscriptions, reconciliation, complimentary access | Explicit product/capacity entitlements rather than role checks |
| Entitlements | `resolveEntitlements` | Separate station, output, public listener and player limits |
| Media | `MediaAsset`, `Track`, protected delivery | Shared upload/QC/metadata/cue services |
| Rights | Track rights, territory, expiry, proof | Usage ledger and reporting adapters |
| Studio | Orders, AudioLab, waveform, multitrack, renders | Product-neutral projects linked to station/programme/episode |
| Programming | Music modes/schedules, School rundowns | Common programme-source contracts and target abstraction |
| Playout | Player resolver, manifests, shared clock, insertions | Single priority resolver returning a signed decision trace |
| Campaigns | Campaign/Promo/Retail Media | Station/channel/ad-break targeting and inventory |
| Podcasts | School podcast implementation | Shared series/episode/feed core plus product policy adapters |
| Analytics | Proof, leases, hourly aggregates | Audience events, privacy retention and product projections |
| Notifications | Jobs, events, preferences, deliveries | Online Radio event types and recipient policies |
| API | Service accounts, versioned routes, webhooks | Versioned station/programming/audience resources |
| Operations | health, audit, recovery, CI | playout SLOs, source failover and capacity controls |

### Product policy layers

- **Retail Radio:** location opening hours, zones, enrolled shop players, promotional campaigns and proof-of-play.
- **School Radio:** supervision, consent, safeguarding, moderation, controlled publication and student access.
- **Online Radio:** stations/channels, 24/7 continuity, presenters, live/relay sources, public audience, distribution, syndication and broadcast rights.

Product layers may constrain shared services, but may not fork them. For example, School podcast publication adds safeguarding checks to the shared podcast publisher; it does not own a separate audio-delivery implementation.

## Proposed Online Radio domain ownership

| Configuration | Recommended owner | Reason |
| --- | --- | --- |
| AutoDJ enabled | `Channel` policy | Continuity is an audio-channel decision, not a provider or device setting. |
| Default AutoDJ Music Mode | `Channel` policy referencing organisation-owned `MusicMode` | One channel can have a consistent fallback across outputs/players. |
| Backup AutoDJ Music Mode | `Channel` policy | Follows the same failover boundary as the default. |
| Radio clocks | `Channel` by default; reusable organisation templates | Clocks govern one programme output but should be reusable across channels. |
| Smart playlists | `Organisation`, optionally assigned to stations/channels | Rules and media are tenant-owned reusable assets. |
| DJ permissions | Assignment scoped to organisation + station/channel + time window | Prevents global role proliferation and limits live authority. |
| Public station settings | `Station` | Branding, slug, public description, domains and directory identity are audience-facing. |
| Podcast ownership | `Station` or organisation; optional channel/programme association | Supports station feeds and network/shared productions without tying media to a player. |
| Listener analytics | `Station` + `Channel`, aggregated under `Organisation` | Audience is public-service traffic, distinct from player health. |
| Station network membership | `Station` membership in an organisation/network agreement | A network may span organisations; ownership and affiliation must be explicit. |
| Stream sources | `Channel` for inputs; `Station` for public distribution outputs | Separates programming input selection from public delivery endpoints. |
| Programmes/presenters | `Station`, linked to channel schedules | They are editorial resources that can recur across slots. |

Do not add these fields in Stage 19.0.

## Playout decision architecture

### Current decision path

1. Authenticate an enrolled player and claim its listener lease.
2. Resolve location opening hours.
3. Resolve published zone/location music schedule to an active music mode.
4. Independently compile campaign insertions.
5. Independently compile approved School Radio insertions.
6. Merge insertions and persist idempotent `PlayoutIntent` rows.
7. Compile a signed manifest, deterministic rotation and shared live clock.
8. Let the player interrupt music for due insertions and send signed proof events.
9. If no schedule is playable, fall back to a configured station/channel public stream URL, otherwise report no programming.

### Future authoritative hierarchy

| Priority | Source | Current status | Recommendation |
| ---: | --- | --- | --- |
| 1 | Emergency Takeover | New for audio; signage takeover is reusable evidence | Add an explicit audited audio takeover source with expiry and two-person policy where required. |
| 2 | Master Live | Partial | Generalise live sessions/source health into a station/channel master source. |
| 3 | Scheduled Presenter Live | Partial via School `LiveStudioSession` | Extract generic live-session lifecycle and retain School supervision adapter. |
| 4 | Scheduled Relay | New, with endpoint/health primitives | Add scheduled relay source and rights/availability policy. |
| 5 | Syndicated Feed | Partial via verified School episode exchange | Generalise agreements; add recorded/live feed sources later. |
| 6 | Recorded Programme | Partial via School episodes/rundowns/broadcast slots | Extract programme/episode/rundown core and preserve school review rules. |
| 7 | Radio Clock | New, with schedule/Show Builder primitives | Add reusable clocks and item/source contracts. |
| 8 | Scheduled Playlist / Music Mode | Existing | Preserve current schedule priority; extend target ownership to channels. |
| 9 | Default AutoDJ | Not on `main`; proposed in PR #99 | Implement as channel policy after the audit gate. |
| 10 | Backup AutoDJ | Not on `main`; proposed in PR #99 | Keep distinct from default, validate playable rights and record decision evidence. |
| 11 | Emergency Cache | New | Add player/runtime cache only after media rights and offline policy are defined. |
| 12 | Critical Failure | Partial no-programming state | Standardise a terminal decision with notification, incident and signed reason. |

### Authoritative resolver

Create a shared, side-effect-light `lib/playout-resolver.mjs` in a later stage. It should accept a normalized context (tenant, station, channel, target, instant, entitlements, sources and availability) and return:

- selected source type and stable source ID;
- decision reason and evaluated priority levels;
- validity window / next decision time;
- fallback chain and unavailable reasons;
- required insertions;
- proof/audit classification;
- operator alert recommendation.

`lib/player-programming.js` should remain the database orchestration adapter and call the resolver. `lib/player-manifest.mjs` should remain a serializer/signing boundary, not acquire business-priority logic. Campaign and School compilers should implement source/insertion contracts consumed by the resolver.

## Stage 19 migration strategy

### Likely new models

- `AutoDjPolicy` — one channel-owned policy (already proposed by PR #99).
- `SmartPlaylist` / `SmartPlaylistRule` — saved, explainable media criteria.
- `RadioClock`, `RadioClockItem` and optional clock templates.
- shared `Programme`, `ProgrammeEpisode` and `ProgrammeRundown` concepts, introduced by adapters rather than destructive School model conversion.
- `StreamSource` and `StreamSourceHealth` for multiple provider-neutral inputs/outputs.
- `PresenterProfile`, `PresenterAssignment` and ephemeral live access grants.
- generic `LiveSession` or a compatibility-backed generalisation of `LiveStudioSession`.
- shared `PodcastSeries`, `PodcastEpisode` and `PodcastFeed`, migrated incrementally from school models.
- `PublicListenerSession` / `ListenerEvent` with privacy-minimised identifiers.
- `ListenerRequest` and moderation decisions.
- `StationNetwork`, membership/agreement and syndication source records.
- advertising break/inventory/order records that reference the existing campaign core.
- distribution destination/publication records.

### Models likely to be extended

- `Station`: public profile, locale/timezone, network/distribution associations; not programme-source priority.
- `Channel`: station role and links to playout policy/sources/clocks.
- `MediaAsset` / `Track`: broadcast metadata, cue points, loudness/QC and richer rights identifiers.
- `MusicMode`: smart-playlist source or rotation constraints while retaining weighted tracks.
- `MusicSchedule` / `ScheduleSlot`: channel targets and typed scheduled sources.
- `PlayoutIntent` / `ProofOfPlayEvent`: authoritative source/decision evidence and audience/rights correlation.
- `CampaignTarget`: station/channel/ad-inventory target types.
- `Plan` / `Subscription`: explicit Online Radio capabilities and separate capacity dimensions.
- `AIJob`: new assistant types only; governance remains unchanged.

### Historical models to preserve

Preserve `Location`, `Zone`, `Player`, existing School models, existing campaign models, production orders and `StationStreamConfig`. Add adapters and new relations; do not rename or rewrite production history.

### Recommended indexes and invariants

- Unique policy per channel: `AutoDjPolicy.channelId`.
- Every policy/source/clock/programme reference must belong to the same organisation and, where applicable, station/channel.
- Prefer composite tenant-safe foreign-key patterns or transactionally enforced ownership. A plain `organisationId` plus unrelated single-column foreign keys can represent cross-tenant combinations at database level.
- Indexed active source lookup: `(channelId, status, priority)` and health scheduling `(enabled, nextProbeAt)`.
- Schedule lookup: `(channelId, status, effectiveFrom, effectiveTo)` plus time-window indexes appropriate to the chosen schema.
- Listener analytics: partition/retention-friendly indexes `(stationId, occurredAt)` and `(channelId, occurredAt)`; never store raw IP indefinitely.
- Clock items: unique `(clockId, position)` and validated non-negative offsets/durations.
- Presenter grants: indexed `(channelId, startsAt, endsAt, status)` and single-use token hashes.
- Rights usage: idempotent event keys and `(rightsWorkId, occurredAt)` indexes.
- Do not store provider credentials unencrypted or include secrets in audit/details JSON.

High-risk relationships are cross-tenant references, station/channel ambiguity, public-listener scale, mutable schedule history and retrofitting rights data after distribution begins.

## Permission and capability map

Current role sets are broad: managers (`OWNER`, `MANAGER`), content roles (`OWNER`, `MANAGER`, `CONTENT_EDITOR`) and viewers. Stage 19 should introduce named capability checks resolved from role + entitlement + assignment, while keeping existing roles compatible.

| Future capability | Owner | Manager | Content editor | Viewer | Presenter/DJ grant | Platform admin |
| --- | --- | --- | --- | --- | --- | --- |
| Station settings | Manage | Manage | View | View | None | Support/override by policy |
| Programming | Publish/manage | Publish/manage | Draft/edit | View | View assigned show | Support/override by policy |
| Music/media | Manage | Manage | Upload/edit | View | Use approved assets | Catalogue/QC administration |
| Clocks | Publish/manage | Publish/manage | Draft/edit | View | View assigned clock | Support |
| Scheduling | Publish/manage | Publish/manage | Draft/edit | View | View assigned slot | Support |
| Live source configuration | Manage | Manage | None by default | View status | None | Provider setup/support |
| DJ operation | Assign/operate | Assign/operate | Only with grant | None | Operate assigned channel/time | Emergency/support controls |
| Podcast publication | Publish | Publish | Draft/edit | View | Contribute if assigned | Support/compliance |
| Advertising | Manage/approve | Manage/approve | Draft assets | View reports | None | Platform inventory/compliance |
| Analytics | View/export | View/export | View | View | Assigned-show view | Cross-tenant operations |
| Rights | Manage/attest/export | Manage/attest/export | Edit metadata | View | View warnings | Catalogue/compliance |
| Network management | Approve | Manage | None | View | None | Platform governance |

Recommended implementation: `hasCapability(context, capability, scope)` with audited assignment records for temporary DJ/live authority. Do not add `DJ`, `PODCASTER`, `AD_MANAGER`, `NETWORK_ADMIN` and similar values to `UserRole` as global roles.

## API reuse map

### Existing APIs to extend

- `/api/stations` and `/api/public/stations/[slug]` for station identity, with versioned public representations later.
- `/api/programming` for compatibility; delegate future source types to versioned services.
- `/api/player/manifest`, `/api/player/state`, `/api/player/proof-of-play` and player health/command routes.
- `/api/media/*` and `/api/admin/catalogue/*` for the single media pipeline.
- campaign, promotion and reporting APIs for Online Radio targets and evidence.
- School podcast/live routes as compatibility clients of extracted shared services.
- `/api/notifications`, `/api/admin/jobs`, `/api/v1/service-account` and integration/webhook services.

### APIs that should remain product-specific

- School safeguarding, consent, student access, moderation and controlled-publication routes.
- Retail location/zone/opening-hour administration and signage device delivery.
- product onboarding/readiness presentations.
- admin-only provider credential setup and emergency operational controls.

### Future versioned resources

- `/api/v1/stations`, `/api/v1/stations/{id}/channels`
- `/api/v1/channels/{id}/schedule`, `/clocks`, `/autodj`, `/sources`
- `/api/v1/programmes`, `/presenters`, `/live-sessions`
- `/api/v1/podcasts`, `/podcast-episodes`, `/feeds`
- `/api/v1/public/stations/{slug}/now-playing` and public player configuration
- `/api/v1/listener-analytics` and `/listener-requests`
- `/api/v1/networks`, `/syndication-agreements`
- `/api/v1/distribution-destinations`

All resources must derive tenant scope from authenticated context, use service-account scopes for machine access, provide idempotency for commands/publications and use stable pagination. Do not expose internal Prisma shapes directly.

## UI and navigation map

The current `/dashboard/radio` product dashboard is a sound entry point, but shared sidebar items still use retail/player vocabulary. Evolve incrementally:

- **Overview** — station health, now playing, continuity, audience and next action.
- **Programming**
  - Schedule
  - AutoDJ
  - Playlists / Music Modes
  - Clocks
- **Live**
  - Live Studio
  - Presenters
  - Connections / Sources
- **Content**
  - Media Library
  - Ruvanas Studio
  - Podcasts
  - Newsroom
- **Audience**
  - Listeners
  - Requests
  - Public Player
- **Distribution**
  - Website
  - Apps / PWA
  - Directories
- **Commercial**
  - Advertising
  - Rights
- **Settings** — station, channels, team/capabilities, integrations and plan.

Implementation should add Online Radio groups only when their capabilities exist. Keep Retail and School navigation stable. Existing shared pages may be linked from multiple product groups; do not clone pages solely to obtain product-specific labels.

## Test reuse analysis

### Existing protective coverage

- **Tenancy/security:** active organisation, tenant access, permissions, route security, service accounts, enterprise security and origin policy.
- **Scheduling/playout:** music scheduling, opening hours, radio control, live channel clock, manifest, campaign playout, School Radio, playback proof and queue.
- **Players:** tokens, listener leases, session management, commands, health and lifecycle integration.
- **Campaigns/media:** campaign scheduling/proof, catalogue upload, promo versioning, Studio files and protected recovery.
- **School/Studio:** publication, podcast/live, networks, safeguarding, student access, AudioLab, waveform, multitrack, Show Builder and audio worker.
- **Platform:** analytics, notifications/jobs, outgoing webhooks, billing, recovery, performance, release quality and final acceptance.

### Stage 19 future test matrix

Legend: U = unit, I = integration/service, R = route security, D = database/invariants, G = regression, P = performance/capacity.

| Stage | Required coverage |
| --- | --- |
| 19.1 AutoDJ | U fallback/rights/hours; I resolver+manifest+proof; R tenant/manager; D same-tenant unique policy; G schedules/campaigns/school/crossfade; P resolver query count. |
| 19.2 Media Library Pro | U metadata/QC/dedupe; I upload/storage/delivery; R ownership; D unique checksums/tenant links; G catalogue/Studio; P large listing/search. |
| 19.3 Smart Playlists | U rule evaluation/explanations; I materialisation/rotation; R author/publisher; D rule validity; G Music Modes; P large-library evaluation. |
| 19.4 Radio Clocks | U clock expansion/transitions; I media/programme binding; R publish; D ordered items; G Show Builder/schedules; P week expansion. |
| 19.5 Advanced Scheduler | U recurrence/timezones/conflicts; I publication/versioning; R scoped writes; D active-version invariants; G retail/school schedules; P horizon compilation. |
| 19.6 Unified Playout | U all priority paths; I sources/insertions/proof; R command boundaries; D idempotent decisions; G all existing playout; P decision latency/load. |
| 19.7 External Live | U endpoint policy; I provider adapter/health; R secret/admin controls; D source ownership; G existing stream config; P probe/connection load. |
| 19.8 DJ Access | U grants/windows; I token lifecycle; R privilege escalation; D overlapping/revoked grants; G auth/team; P token validation. |
| 19.9 Live Failover | U state machine; I probe-to-switch; R override; D single active source/evidence; G stream health/notifications; P recovery time. |
| 19.10 Browser Live Studio | U mixer/session transitions; I signalling/ingest/recording; R grants; D session ownership; G School live/Studio; P latency/concurrency. |
| 19.11 Voice Tracking / Segue | U cue/fade math; I render/clock binding; R project access; D cue bounds; G waveform/multitrack; P preview/render. |
| 19.12 Audio Processing | U profile/filter graph; I worker/QC/storage; R job access; D idempotent outputs; G current renders; P throughput/resources. |
| 19.13 Listener Analytics | U privacy/session aggregation; I ingestion/jobs; R tenant/export; D idempotency/retention; G player analytics; P event volume. |
| 19.14 Public Player | U state/now-playing; I anonymous delivery/capacity; R public/private separation; D listener leases; G enrolled player; P concurrent listeners. |
| 19.15 Listener Interaction | U validation/moderation; I request lifecycle; R abuse/tenant controls; D dedupe/rate limit; G support/notifications; P burst load. |
| 19.16 Podcasts | U feed/publication; I media/transcript/RSS; R publication rights; D series/episode tenant links; G School podcast; P feed/media delivery. |
| 19.17 Station Website | U page/config rendering; I public APIs/domains; R admin writes; D slug/domain uniqueness; G homepage/public routes; P cache/SEO pages. |
| 19.18 PWA/Mobile | U offline/update state; I install/cache/API; R token storage; D device registration; G web/player; P cache/startup/bandwidth. |
| 19.19 Multi-Station Network | U membership/policy; I cross-org operations; R network authority; D agreement boundaries; G School networks; P fleet queries. |
| 19.20 Syndication | U rights/windows; I offer/relay/import; R approvals; D idempotent agreements; G exchange/campaigns; P feed fan-out. |
| 19.21 Advertising | U break/pacing/priority; I campaign/inventory/proof; R approvals; D booking conflicts; G campaigns/Retail Media; P placement volume. |
| 19.22 Rights/Royalty | U territory/work mapping; I usage ledger/exports; R attestation/export; D immutable/idempotent events; G proof/reports; P large exports. |
| 19.23 Distribution | U adapter contracts; I webhook/directory/CDN; R credentials; D destination state; G integrations; P retries/fan-out. |
| 19.24 AI Programme Director | U governed recommendations; I provider/job/review; R approval/data policy; D provenance; G AI governance; P cost/rate limits. |
| 19.25 Newsroom | U editorial transitions; I Studio/publication; R assignments/review; D source/audit history; G School newsroom; P search/listing. |
| 19.26 Enterprise/Scale | U limits/policies; I full topology; R enterprise isolation; D partition/invariants; G full acceptance; P soak/failover/capacity. |

CI should retain the existing static, dependency audit, media toolchain, Prisma validation/migration, full test, production build and route-level acceptance gates.

## Operational risk assessment

| Area | Rating | Primary risk | Required mitigation |
| --- | --- | --- | --- |
| 24/7 operation | High | Dead air, stale decisions, deploy interruption | Source hierarchy, continuity SLOs, health alerts, rolling/failover strategy |
| Large media libraries | High | Slow queries, duplicate media, expensive metadata jobs | Pagination/search indexes, dedupe, async QC, storage lifecycle |
| Live streaming | External Dependency | Ingest/output availability and bandwidth | Provider abstraction, redundant sources, monitored SLAs |
| WebRTC/live studio | External Dependency | NAT, latency, echo, browser/device variation | Managed media infrastructure, TURN, soundcheck, fallback |
| Listener event volume | High | Write amplification, privacy and retention | Batched ingestion, aggregation, partitioning, minimisation |
| Podcast storage | Medium | Egress cost, retention and feed consistency | Shared protected storage, lifecycle rules, immutable media versions |
| Multi-station networks | High | Cross-tenant authorisation and cascading changes | Explicit agreements, scoped grants, immutable audit |
| Dynamic advertising | High | Conflicts, pacing, rights and proof disputes | Deterministic decision evidence, inventory locks, reconciliation |
| Rights reporting | External Dependency | Incomplete metadata and authority-specific rules | Rights foundation early, immutable usage ledger, validated exports |
| AI providers | External Dependency | Data use, cost, hallucination and provenance | Existing governance, human review, provider policies, budgets |
| Streaming infrastructure | External Dependency | CDN/origin failure and listener concurrency | Multi-provider adapter, health/failover, capacity testing |

## External dependency map

| Ruvanas can build | External partnership, certification or provider required |
| --- | --- |
| Media library, metadata, QC workflow and rights fields | Music licences and recognition by royalty/reporting authorities |
| Playout resolver, clocks, AutoDJ and scheduling | Streaming origin/CDN capacity and commercial SLA |
| Browser studio application and session controls | WebRTC media services/TURN or managed live-ingest infrastructure |
| Public player, website and PWA | Native App Store / Play Store approval for native distribution |
| Now-playing and directory export adapters | Acceptance and credentials from external radio directories |
| Car-mode compatible APIs/metadata | Apple CarPlay / Android Auto app certification and native integration |
| Voice-assistant skills/connectors | Alexa/other assistant platform approval |
| AI job orchestration, review and provenance | External AI/TTS provider contract, terms, quotas and voice rights |
| Advertising inventory, campaign logic and proof | Demand exchanges, agencies, measurement standards and commercial agreements |
| Rights usage ledger and export generators | Territory-specific societies, identifiers and reporting specifications |
| Podcast feeds, hosting logic and analytics | Directory submission/acceptance and external podcast ecosystem rules |

External dependencies must be represented behind provider contracts and adapters. Product truth must not depend on one named provider.

## Dependency-safe Stage 19 roadmap

The proposed order is broadly sound because it builds recorded continuity before live complexity, adds the unified resolver before live failover, and delays scale/enterprise work until product flows exist.

One amendment is recommended: establish **rights and broadcast metadata foundations during 19.2**, while retaining authority-specific reporting as 19.22. Deferring all rights work to 19.22 would force media, podcasts, syndication, advertising and distribution to be retrofitted.

1. **19.0 Architecture Audit** — this safety gate.
2. **19.1 24/7 AutoDJ** — channel policy, default/backup modes and no-gap evidence.
3. **19.2 Media Library Pro + rights metadata foundation** — single shared media eligibility/QC layer.
4. **19.3 Smart Playlists** — rule-based inputs to rotations.
5. **19.4 Radio Clocks** — reusable hour structure.
6. **19.5 Advanced Scheduler** — typed sources and channel targets.
7. **19.6 Unified Playout Engine** — one authoritative priority resolver.
8. **19.7 External Live**.
9. **19.8 DJ Access**.
10. **19.9 Live Failover**.
11. **19.10 Browser Live Studio**.
12. **19.11 Voice Tracking / Segue**.
13. **19.12 Audio Processing**.
14. **19.13 Listener Analytics**.
15. **19.14 Public Player**.
16. **19.15 Listener Interaction**.
17. **19.16 Podcasts**.
18. **19.17 Station Website**.
19. **19.18 PWA/Mobile**.
20. **19.19 Multi-Station Network**.
21. **19.20 Syndication**.
22. **19.21 Advertising**.
23. **19.22 Rights/Royalty reporting**.
24. **19.23 Distribution**.
25. **19.24 AI Programme Director**.
26. **19.25 Newsroom**.
27. **19.26 Enterprise/Scale**.

## Exact recommendation for Stage 19.1

Do not start a second AutoDJ implementation. Reconcile the existing unmerged PR #99 with this audit and then use it as the Stage 19.1 candidate.

The proposed choices that should be retained are:

- one optional policy per `Channel`;
- organisation-owned default and backup `MusicMode` references;
- `FOLLOW_LOCATION_HOURS` versus `RUN_24_7` policy;
- existing schedule priority ahead of AutoDJ;
- reuse of synchronized clock, two-second crossfade, campaigns, School insertions, notifications, audit and signed proof;
- disabled-by-default migration and additive rollback strategy.

Before merge, the Stage 19.1 candidate must address or explicitly accept these audit findings:

1. Add a database/service invariant proving the policy, channel and both music modes belong to the same organisation. Route validation alone is necessary but not a complete data invariant.
2. Centralise playable-track eligibility. The current manifest and PR candidate admit only ready, licensed `RUVANAS_CATALOGUE` music, while the Online Radio UI describes station-owned audio. Stage 19.1 must either deliberately remain catalogue-only and say so, or use the shared eligibility policy that Stage 19.2 will own. It must not silently promise organisation music it cannot play.
3. Keep `player-programming.js` as the orchestration adapter and make the fallback decision testable without database/notification side effects.
4. Preserve existing location/zone scheduling and School/Retail behaviour exactly.
5. Add decision-source proof and deduplicated critical alerts without treating an ordinary covered gap as an incident.
6. Rebase only after Stage 19.0 is accepted, run the full CI gate and deploy solely to the paid Ruvanas service.

## Final audit summary

### Existing systems that will be reused

Identity, tenancy, roles, entitlements, complimentary access, station identity, channels, media, tracks/rights, Music Modes, schedules, synchronized clocks/crossfades, player security, campaigns, School insertion rules, proof, Studio/audio processing, podcast/live primitives, analytics, jobs, notifications, API/webhooks, audit, billing and recovery.

### Systems that should be generalised

Programming targets, playout source contracts, media eligibility, live sessions, podcasts, newsroom workflows, campaign targets, listener analytics, network agreements and stream-source/provider adapters.

### New systems genuinely required

AutoDJ policy, smart playlists, radio clocks, typed programmes, provider-neutral multi-source live/relay inputs, presenter grants, public listener events, generic podcast/feed ownership, public station experience, station networks/syndication, radio advertising inventory, distribution adapters and enterprise scale controls.

### Main engineering risks

Cross-tenant relationships, inconsistent station/channel vocabulary, parallel infrastructure, 24/7 continuity, live-provider dependency, public listener scale/privacy, rights retrofitting, dynamic-ad decision evidence and cross-organisation network authority.

The governing rule remains: **Stage 19 expands the shared Ruvanas platform; it does not create another platform inside it.**
