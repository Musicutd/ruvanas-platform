# Studio A Architecture Audit and UX Refresh

## Outcome

Studio A keeps the existing Ruvanas audio architecture and adds one simpler Studio workspace inside the protected School Radio product. A project dashboard now routes people to Record, Waveform or Multitrack without displaying all three editors on one long page. One Beginner or Advanced choice is shared across those tools and remembered on the device.

No database migration, billing change, new audio engine, public media route or deployment change is included.

## Reuse and gap matrix

| Specification area | Audit result | Studio A decision |
| --- | --- | --- |
| Immutable uploaded and recorded media | Existing - reuse unchanged | Continue using `MediaAsset`, `AudioTake`, protected streams, quarantine promotion and resumable uploads. |
| Audio projects and version history | Existing - reuse unchanged | Continue using `AudioProject` and immutable `AudioProjectVersion` snapshots. |
| Waveform rendering and non-destructive edits | Existing - reuse unchanged | Keep cached peaks, selection edits, markers, undo and redo, and the existing waveform route. |
| Multitrack engine | Existing - reuse unchanged | Keep tracks, clips, gain, pan, fades, mute, solo, arm, lock, automation, ducking and server render graphs. |
| Server audio worker | Existing - reuse unchanged | Keep FFmpeg and FFprobe rendering, loudness parsing, normalization, limiting and protected outputs. |
| Approval and later-edit invalidation | Existing - reuse unchanged | Keep the existing render review and multitrack output invalidation logic. |
| Rights-aware source selection | Existing - reuse unchanged | Keep organisation-owned audio, ready takes and currently licensed catalogue sources. |
| Studio navigation | Existing - needs enhancement | Replaced the three-editor page stack with Projects, Record, Waveform and Multitrack tabs. |
| Project starting point | New capability required | Added a recent-project dashboard with status, version, type, update time and correct editor routing. |
| Beginner and Advanced experience | Existing - needs enhancement | Added one persistent workspace choice and connected it to Record, Waveform and Multitrack. |
| Recording essentials | Existing - needs enhancement in Studio B | Input choice, meter, record, pause, stop, recovery and retake foundations exist. Count-in, clearer retake flow, monitoring support and armed-track recording remain. |
| Waveform essentials | Existing - needs enhancement in Studio B | Split, ripple delete, silence, trim, duplicate, gain, fades, markers, zoom and keyboard controls exist. Clipboard operations, stereo channel view and refined direct manipulation remain. |
| Voice Cleanup | Existing - needs enhancement in Studio C | Basic noise cleanup, speech filters, high-pass filtering, compression and limiter filters exist in the worker. The safe Repair Voice panel, de-hum, de-ess, voice EQ choices and Before/After preview remain. |
| Effects and loudness | Existing - needs enhancement in Studio D | A small set of track presets, LUFS parsing, normalization and limiting exist. Curated rack controls, True Peak presentation, admin presets and quality summary remain. |
| Multitrack polish | Existing - needs enhancement in Studio E | Core state and rendering exist. Direct drag and drop, visual clip positioning, explicit crossfade UI, timeline zoom and plan-aware 8/16-track presentation remain. |
| Product-aware destinations | Existing - needs enhancement in Studio F | Promo handoff, School episode submission, Show Builder, podcast, newsroom and voice-track reuse exist separately. A governed Studio destination chooser remains. |
| Full acceptance programme | New capability required in Studio G | Audio quality, browser compatibility, large-project, determinism and cross-product acceptance remain the final gate. |
| VST or AU hosting, unlimited tracks, surround, MIDI, complex buses, full spectral repair and mastering-suite depth | Explicitly deferred - do not build | These remain outside the programme. |

## Architecture and duplication controls

- There remains one `AudioProject` and `AudioProjectVersion` model family. Studio A adds no parallel project or history model.
- There remains one waveform state implementation and one multitrack state implementation.
- There remains one protected media library and one audio worker path.
- The new project dashboard reads the existing School AudioLab endpoint and opens the existing editors. It does not copy media or create projects by itself.
- Quick Record and Waveform now exclude multitrack projects from their selectors; multitrack work stays in the existing Multitrack tool.
- Every existing School Radio endpoint still requires the School product, organisation membership and content role. Retail and Online Radio receive no accidental access through this UI change.

## Studio A implementation

- Added an accessible Studio tool tab list with keyboard navigation and visited-panel state preservation.
- Added a responsive project dashboard with recent project status, type, version and update time.
- Added direct routing from each project to its existing Record, Waveform or Multitrack tool.
- Added a shared Beginner and Advanced choice stored locally on the device.
- Simplified the Beginner recording finish into safe choices while retaining detailed trim, fade, loudness and cleanup controls in Advanced.
- Kept Waveform advanced controls and Multitrack automation aligned with the shared experience setting.
- Added a clear 16-track guard in the Multitrack UI to match the existing server normalization limit.

## Expected Studio B to Studio G changes

| Stage | Likely components and services | Schema or migration expectation |
| --- | --- | --- |
| Studio B | Recorder transport, input meter, waveform controls and recording-to-armed-track workflow | Prefer existing models. Add fields only if count-in, device or armed-record metadata must survive versions. |
| Studio C | Repair Voice panel, preview service and bounded worker filter configuration | Store non-destructive cleanup settings in version state. A typed JSON evolution may avoid a migration. |
| Studio D | Effects rack, loudness quality panel, processing presets and worker reporting | An administrator-owned preset model may require a migration; do not hard-code one global target. |
| Studio E | Timeline interaction, clip gestures, crossfade and entitlement-aware track limits | Prefer existing track, clip and JSON automation fields. Add schema only for data that cannot be versioned safely in current state. |
| Studio F | Destination chooser and governed handoff services for Retail, School and Online Radio | Destination and immutable handoff records may require a migration after the existing workflow models are reconciled. |
| Studio G | Acceptance fixtures, browser checks, deterministic-render tests and operational evidence | No product schema change expected. |

## Security and product boundaries

Studio A keeps School Radio product isolation, organisation-scoped queries, role checks, private media streaming, licensed catalogue filtering, immutable source media and server-side rendering. It does not expose storage keys or private URLs, does not send audio to a third party, and does not change subscriptions, billing events or complimentary access.

## Validation plan

- Focused unit tests cover safe mode normalization, project summaries and editor routing.
- Workspace integration checks cover accessible tabs, responsive behavior, reuse of the three existing editors and retention of School Radio route guards.
- Existing AudioLab, waveform, multitrack, worker, media, product-isolation and route-security suites remain regression gates.
- The production build and Prisma generation must pass before Studio A is considered safe to publish.
