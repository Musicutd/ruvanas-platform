# Studio Basic + Pro + Broadcast Console local release gate

This is a local implementation checkpoint against `main` `023e26451bd72543dcf0e5c1484b65f9e6951be2`, not publication approval. No push, pull request, merge or deploy was performed.

## Reuse and implementation

The existing six-product, thirty-plan catalogue, shared Studio entitlement, Waveform/Multitrack editors, Manual Playout, Radio Clocks, Voice Tracking, Browser Live Studio, scheduler, AutoDJ, protected media, rights checks, destination profiles and worker were reused. The STP.0 matrix is in `studio-broadcast-console-stp0-audit.md`.

Locally added: a Pro-only Broadcast Console tab and read-only second-screen monitor; presenter layout preferences; a Daily Log projection that keeps scheduled items and verified proof-of-play separate; scoped presenter notes; scoped hot-cart banks and media references; broadcast mix-point storage, validation and preparation defaults; channel/output-health summaries. The Console uses existing Studio access and product entitlements. It does not fire carts, launch microphone capture, or send an item to public output.

The new migration is `20261120000000_studio_broadcast_console`. It adds five small reference/configuration tables: `StudioConsolePreference`, `StudioCartBank`, `StudioCart`, `StudioMixPoint`, and `StudioPresenterNote`. It does not duplicate media bytes, the scheduler, playout, broadcasting, or proof tables.

| Roadmap | Local status |
| --- | --- |
| STP.0 architecture/dependency audit | Complete; evidence and classifications recorded separately. |
| STP.1–STP.5 Basic/Pro, Waveform and Multitrack | Existing foundations reused; regression suite passed. |
| STP.6–STP.7 Manual Playout and three-area workflow | Existing queue and Prepare reused; mix-point defaults added. Actual listener output remains disconnected. |
| STP.7A Broadcast Console | Partial presenter view, layouts, Daily Log, cart configuration, notes and monitor. Live controls and full editing remain open. |
| STP.8–STP.8A scheduling, fallback and distribution | Existing authority reused. Real output bridge and provider-backed transport are unverified. |
| STP.9–STP.11 packs, products, security and downgrade | Existing foundations reused; new Console is Pro- and tenant-gated. Live rights recheck still needed. |
| STP.12 final release gate | Not passed; see blockers below. |

## Incomplete acceptance and release blockers

1. **Manual output bridge:** existing Manual Playout transitions are not consumed by the player resolver/manifest. `ON_AIR` in the server queue is not evidence of listener output. Integrate a priority-aware, server-authoritative output path, then prove that scheduled, emergency and campaign events interrupt/resume safely and empty queues return to AutoDJ.
2. **Transport:** external Icecast/SHOUTcast profiles require a configured compatible encoder provider. Browser Live microphone output requires its real-time provider. Neither is available in this local workspace. No external destination or microphone delivery was tested.
3. **Console completeness:** live hot-cart firing, direct microphone controls, fully adjustable panels, visual Radio Clock drag/reorder with conflict warnings, in-context Voice Tracking handoff, sponsor/spot board, and future-only Daily Log edits are not complete. The Console links to existing Radio Clock, Voice Tracking and Browser Live workflows rather than duplicating them.
4. **Rights and output proof:** a live output bridge must re-evaluate every music item for the active product, territory, catalogue tier, licence window and takedowns at use time. Existing Manual Playout readiness is too shallow for that final gate. Planned Daily Log entries never count as verified plays.
5. **End-to-end acceptance:** no disposable PostgreSQL, streaming provider or player fleet is attached to this worktree. Schema and build can be validated locally; migration apply, tenant/role flows, actual playback, fallback, destination reconnect and downgrade tests need an isolated environment.

## Verification checkpoint

- Prisma schema validation and client generation passed using a dummy local validation URL and the installed Prisma engines.
- Production Next.js build passed, but prerender attempted database queries against the dummy URL; this is not a live-data acceptance check.
- Studio tests and static integrity checks passed. Full suite: 800 tests, 792 passed, 8 environment-dependent skips, 0 failed. The Windows checkout's schema line endings were normalised for a pre-existing Organisations test that expected LF-only source text.
- No release-gate claim is made for live broadcasting. **Not safe to publish, merge or deploy as the full requested expansion.**
