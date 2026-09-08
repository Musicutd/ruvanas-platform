# Studio D — Effects and loudness

Studio D adds an approachable, non-destructive finishing workspace to Ruvanas Studio. It extends the Studio A–C project, render and voice-cleanup foundations without changing source media or creating a new database migration.

## User journey

The waveform editor now has three focused tabs: **Edit audio**, **Clean voice**, and **Effects & master**. The finishing tab asks for two decisions in order:

1. Choose a sound preset: Broadcast Voice, Podcast Voice, Promo Voice, Telephone Voice, Warm Voice, Clean Interview, or no effects.
2. Choose a delivery preset: Podcast, Online Radio, Retail Promo, or School Programme.

Advanced users may refine tone, compression, gate, reverb, delay, high/low-pass filters, loudness, True Peak, loudness range, and limiter settings. These values are bounded before they are saved or rendered.

## Rendering and quality

Effects are stored as project edit decisions and applied only by the protected server-side audio worker. The worker applies voice cleanup, the curated effects rack, and then the final mastering target. It measures the finished output and records:

- integrated loudness (LUFS);
- True Peak (dBTP);
- loudness range (LU);
- a **Ready** or **Needs attention** quality summary with plain-language findings.

Users can create a mastered preview before requesting the final review render. Preview renders do not create approvable output versions.

Multitrack projects use the same sound presets per track and the same delivery presets on the final master. Existing Speech Cleanup and Radio Voice project values remain compatible.

## Administration and safety

Published radio outputs continue to use the organisation's governed broadcast processing profile when one is configured. This takes priority over an editor-level delivery preset, preserving admin-controlled network targets. Tenant checks, protected media streaming, version snapshots, approval controls and immutable source audio are unchanged.

Studio D does not include Studio E automation or publishing work.
