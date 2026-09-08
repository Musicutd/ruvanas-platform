# Studio C — Voice Cleanup

Studio C adds a focused, non-destructive Repair Voice workflow to the existing waveform editor. It does not introduce a second editor, a browser-only audio processor, or a general effects rack.

## Subscriber experience

- Beginner mode offers four clear starting points: Off, Gentle repair, Clean dialogue, and Broadcast voice.
- The waveform workspace is split into **Edit audio** and **Clean voice** tabs, so repair controls do not crowd the precision timeline.
- Advanced mode reveals bounded controls for background noise, low-frequency rumble, 50/60 Hz electrical hum, de-essing, voice tone, speech levelling, and clipping protection.
- The chosen settings are saved with the immutable editor version. The original MediaAsset and captured take are never modified.
- “Create Before/After preview” queues two MP3 previews from the same saved version. The Before render bypasses only Voice Cleanup; the After render applies it. The page enables a single-player Before/After toggle after both are ready.

## Protected rendering

The existing audio worker remains authoritative. Its deterministic filter graph applies the bounded repair chain before the existing final loudness step:

1. high-pass rumble filter;
2. optional 50/60 Hz hum notches;
3. background-noise reduction;
4. de-essing;
5. selected voice EQ;
6. speech levelling;
7. optional clipping limiter.

Comparison renders are explicitly marked as `studioPreview` outputs. They create protected, tenant-scoped MediaAssets for listening but do not create PromoVersion records, processing jobs, approvals, schedules, or publishing actions.

## Compatibility and scope

- Historical `noiseCleanup: true` snapshots map to the Gentle repair preset.
- No database migration is required because cleanup decisions live in the existing JSON edit snapshot and preview identity lives in the existing render result JSON.
- Existing project tenancy, source validation, version history, media streaming, render polling, and final render behaviour are preserved.
- Curated creative effects, LUFS/True Peak mastering controls, and quality warnings remain Studio D work.
