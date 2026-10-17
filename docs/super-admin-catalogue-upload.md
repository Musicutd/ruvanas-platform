# Super Admin catalogue upload

The Ruvanas Music Catalogue now has a controlled upload workflow at
`/admin/catalogue`. It is intentionally separate from organisation promotional
audio.

## Access and publication

- Only a signed-in platform `SUPER_ADMIN` may submit catalogue music.
- Every submission requires a rights holder, a licence or rights reference,
  permitted territories, and an explicit rights confirmation.
- A new track is `DRAFT` by default. The uploader may explicitly select
  **Mark this track ready for programming immediately** when the file and rights
  have already been reviewed.
- A `READY` track still does not play automatically. A Super Admin must add it
  to a Music Mode and publish an applicable music schedule.
- A catalogue track with an expired licence date is automatically excluded from
  Music Mode eligibility and generated player manifests.
- Organisation promo upload permissions cannot create or modify catalogue music.

## New genres in spreadsheets

- Single and ZIP + CSV/XLSX uploads detect missing genre names automatically.
- **Check files** and metadata matching are read-only. The preview identifies
  new genres and their tier; it does not create a genre, upload audio or import
  a track.
- The deliberate **Import**/**Upload** action creates new genres in the same
  database transaction as each track, its genre links and its audit entry.
- New canonical genres follow the existing AutoDJ tier matrix; custom genres
  default to Premium. Existing genre tiers and review settings are preserved.
- Bulk tracks follow the explicit batch **ready for programming** choice,
  including those using new genres. The default is **Draft**; readiness requires
  both the rights confirmation and the deliberately selected readiness option.
  A Ready track still needs a Music Mode and published schedule for playback.
- Single-song uploads retain their existing new-genre **Draft** review policy.
- Inactive, pending, rejected or ambiguous existing names/aliases remain blocked;
  an upload cannot reactivate or replace them. No supplier sync is enabled.

## Storage and validation

- Supported files are MP3, WAV, OGG, and M4A, up to 50 MB.
- The server checks the extension, declared MIME type, and audio file signature.
- Files first enter the private `quarantine/catalogue/` prefix, then move to a
  checksum-addressed `catalogue/music/` key.
- Duplicate binaries are rejected when they already belong to a catalogue
  track.
- A failed upload leaves no playable track and records the media item as
  rejected when cleanup is required.

## Audit trail

Successful uploads create `CATALOGUE_TRACK_UPLOADED` audit records with the
uploader, track and media identifiers, rights declaration, checksum, file size,
selected genres, and initial publication state. The track also retains the
rights confirmer and confirmation time directly.

The rights declaration records the operational basis supplied by Ruvanas; it
does not itself create or verify a music licence.

