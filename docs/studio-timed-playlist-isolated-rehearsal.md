# Timed playlist: isolated file-output rehearsal

This is an **offline test**, not permission to connect an encoder to Centova. Keep the production Radio Test 105 source, worker, music and listener URL untouched. Use only self-owned synthetic tones in a private, disposable rehearsal directory. No distributor or customer music belongs in this fixture.

## What to prepare

1. On an isolated machine with the intended Liquidsoap version, place the self-owned test files in a private cache and render the file-only M3U/script using `renderTimedRehearsalBundle`. Its returned `expectedOrder` must contain the exact frozen `position`, `trackId`, `startOffsetSeconds` and `endOffsetSeconds` values. Do not use the deduplicated MusicMode pool in place of this list. The script must have only `output.file`, never a network/source output.
2. Use distinct tones for each test track. A short A-B-A example has A = 440 Hz and B = 660 Hz, six/seven/six seconds long with planned starts at 0/4/9 seconds and a final end at 15 seconds. Confirm the media files' own durations and listen to them before running Liquidsoap.
3. Run the file-only script in the isolated runtime. Preserve the original output MP3 and its checksum. Decode a **copy** to mono, signed 16-bit little-endian PCM at 16 kHz (`.s16le`); do not rename an MP3 to `.s16le`.
4. Create a small JSON manifest from the returned `expectedOrder` and the actual self-owned test-tone frequencies. For the example only:

```json
{
  "format": "RUVANAS_SELF_OWNED_TEST_TONES_V1",
  "expectedOrder": [
    { "position": 0, "trackId": "tone-a", "startOffsetSeconds": 0, "endOffsetSeconds": 6 },
    { "position": 1, "trackId": "tone-b", "startOffsetSeconds": 4, "endOffsetSeconds": 11 },
    { "position": 2, "trackId": "tone-a", "startOffsetSeconds": 9, "endOffsetSeconds": 15 }
  ],
  "toneHzByTrackId": { "tone-a": 440, "tone-b": 660 }
}
```

Run `node scripts/analyze-studio-timed-rehearsal-pcm.mjs <absolute-path-to-output.s16le> <absolute-path-to-manifest.json>` from the repo root. Exit 0 means the decoded local sample matched the bounded tone checks; exit 2 means a measured mismatch; exit 1 means invalid inputs. The output contains the decoded PCM and manifest SHA-256 hashes so they can be correlated with the saved evidence. Preserve the **original MP3** and its separate checksum as well.

The checker recognizes distinct tone occurrences, approximate starts (±1 second), total duration (±0.5 second), and at least two 250 ms windows where both adjacent tones are audible. It rejects a simple hard cut. It does **not** measure a sample-accurate two-second fade curve, authenticate where a recording came from, verify rights, or prove listener delivery. The result always says `listenerVerified: false`. Listen to the original output and inspect encoder logs separately; if timing or audibility is uncertain, mark the rehearsal failed rather than overriding the checker.

Only after this file-output rehearsal passes should the separate, non-production Centova listener procedure in [the isolated acceptance plan](studio-isolated-centova-acceptance.md) be attempted. That plan still requires independent listener capture, output/rights arbitration and all six end-to-end scenarios. Do not use a green offline result to unlock Manual controls or publish the full Broadcast Console.

Before any future source handoff, the scheduled programme must cover the **entire** frozen sequence. A generation tolerance may allow an audio file slightly longer than its nominal schedule block for drafting, but that is not safe output authority. The local read-only authority check rejects such an overrun, as well as stale evidence, a changed published programme, a competing source or a required insertion. A separate diagnostic loader now reads the frozen version and schedule authority inside one repeatable-read database transaction. It still has no encoder command or output-time rights recheck.
