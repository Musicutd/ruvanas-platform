# Studio B — Recording and waveform essentials

Studio B completes the basic capture and precision-editing promise inside the existing Ruvanas Studio workspace. It does not introduce another editor, media store, approval path, or public sharing surface.

## Delivered

- Persistent microphone input check with a live accessible level meter and explicit clipping warning.
- Browser input-device selector, record, pause, resume, stop and retake controls.
- Optional three-second count-in and advanced headphone monitoring where browser audio support is available.
- A clear destination choice: create an immutable waveform take or place that take directly at the end of an armed, unlocked multitrack track.
- Resumable protected upload, browser recovery, immutable source storage and tenant access checks reused from AudioLab.
- Direct-to-track capture creates a recoverable project version and invalidates any formerly approved output.
- Waveform copy, cut and paste, crop/trim, split, ripple/keep-gap delete, silence, gain, fades, normalization, markers and named regions.
- Visible undo/redo depth and latest-edit status.

## Safety and compatibility

- No database migration is required; existing `AudioTake`, `AudioTrack`, `AudioClip` and `AudioProjectVersion` records are reused.
- Raw recordings remain immutable. All changes are edit decisions or new timeline clips.
- The server remains authoritative for upload validation, organisation ownership, track arming/locking and approval invalidation.
- The existing server render and moderation pipelines remain unchanged.

## Deliberate limitation

The current stored waveform cache is mono peak data. A basic stereo channel view remains optional and is not represented as false stereo; it can be added later if the waveform worker begins storing separate left/right peak arrays. This does not block Studio B capture or editing acceptance.
