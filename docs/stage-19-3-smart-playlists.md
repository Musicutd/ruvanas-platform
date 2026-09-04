# Stage 19.3 — Smart Playlists

## Purpose

Stage 19.3 lets an organisation define a reusable music rotation with clear rules instead of selecting every track manually. It reuses `Track`, `MediaAsset`, rights review, `MusicMode`, scheduling, Continuous AutoDJ, manifests and proof of play. It does not introduce a second playlist or playout engine.

## Subscriber workflow

1. An owner, manager or content editor creates a draft Smart Playlist in Radio Programming.
2. The author chooses up to twelve AND rules covering genre, artist, album, release year, content rating or library source.
3. Ruvanas applies the central Stage 19.2 rights and media-eligibility gate for the selected product and territory.
4. The preview explains why every selected track matches. It never changes live playback.
5. An owner or manager publishes the reviewed result. The eligible tracks are materialised into a dedicated `MusicMode`, so the existing scheduler, AutoDJ and synchronized player continue unchanged.
6. Later rule edits create a new version. The current materialised rotation remains live until the new version is explicitly published.

## Governance and safety

- Organisation identity comes only from the authenticated active membership; API input cannot select another tenant.
- Content editors may author and preview. Only owners and managers may publish or archive.
- Every create, rule change, publication and archive is audited.
- A publication with zero eligible tracks is rejected, preventing an empty Smart Playlist from replacing a working rotation.
- Organisation music must have approved rights for the selected Ruvanas product, territory and time window. Shared catalogue behaviour remains unchanged.
- Smart playlists own dedicated `MusicMode` rows marked `SMART_PLAYLIST`; manually curated modes are never overwritten.

## Data model

- `MusicMode.source` distinguishes manual rotations from Smart Playlist materialisations.
- `SmartPlaylist` owns configuration, version, publication identity, product/territory context and materialisation evidence.
- `SmartPlaylistRule` stores ordered, typed rules with database constraints.
- Published track membership continues to use `MusicModeTrack`, preserving the proven playout contract.

## Performance

Rules are translated into a bounded database query. Results are deterministically ordered and capped at 1,000 tracks. Eligibility is checked again in application code before materialisation so query optimisation cannot weaken rights enforcement.

## Rollback

The change is additive. Rolling back the application leaves generated Music Modes and their materialised `MusicModeTrack` rows readable by the previous playout code. The migration should be reversed only after Smart Playlist records are archived or exported.
