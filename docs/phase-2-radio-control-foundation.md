# Phase 2: Radio Control foundation

This milestone introduces the shared programming vocabulary required by both Retail Radio and the future School Radio product. It extends the current media library instead of creating a second storage system.

## Delivered

- `Track` stores broadcast metadata for one approved `MediaAsset`.
- `MusicMode` is an organisation-owned programming profile with a stable tenant-scoped slug.
- `MusicModeTrack` links approved tracks to a mode with a validated selection weight.
- Database checks constrain release years and track weights independently of the API.
- Super Admin APIs register rights-cleared catalogue tracks and create audited draft music modes.
- The Music Modes admin screens can create empty draft modes safely while the commercial catalogue remains intentionally disabled.
- Track eligibility prevents draft, rejected, non-music, or another organisation's private assets from entering a mode.

## Product boundary

The uploaded audio remains a `MediaAsset`; `Track` adds programming metadata without duplicating the file. Ruvanas catalogue tracks are platform-owned and may later be licensed to eligible organisations. Organisation-owned music remains isolated to its owner.

Music modes do not yet decide what plays. The next milestone adds versioned schedules and deterministic resolution using each location's IANA timezone and opening hours. School Radio will later reuse that same resolver for approved episodes and broadcast slots.

## Safety

- Catalogue track and music-mode management is restricted to `SUPER_ADMIN`.
- Every creation is written to the audit log in the same database transaction.
- A mode may contain at most 200 distinct tracks.
- Weights are whole numbers from 1 to 1000.
- Catalogue upload is available only to `SUPER_ADMIN` through the controlled, rights-declared workflow documented in `docs/super-admin-catalogue-upload.md`. Subscriber playback still requires an explicitly ready track, Music Mode assignment, and published schedule.

