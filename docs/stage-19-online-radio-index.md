# Stage 19 — Online Radio roadmap index

## Baseline

- Architecture baseline: `main` through Stage 19.21 at `9608d80`
- Architecture gate: Stage 19.0
- Detailed audit: [`stage-19-0-online-radio-architecture-audit.md`](./stage-19-0-online-radio-architecture-audit.md)
- Status values: `NOT STARTED`, `IN DESIGN`, `IN DEVELOPMENT`, `PR OPEN`, `MERGED`, `DEPLOYED`, `BLOCKED`

> A stage is `DEPLOYED` only when its commit is on `main` and the paid Ruvanas service reports a successful deployment of that commit. Branches and open pull requests are not live releases.

## Roadmap

| Stage | Scope | Status | PR | Main commit | Paid deployment | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 19.0 | Online Radio architecture and reuse audit | MERGED | [#100](https://github.com/Musicutd/ruvanas-platform/pull/100) | `49ff8cd` | Not required | Documentation-only safety gate accepted. |
| 19.1 | 24/7 AutoDJ | DEPLOYED | [#99](https://github.com/Musicutd/ruvanas-platform/pull/99) | `cf848f0` | `dep-dadcptijnfac73eeqj8g` | Paid Ruvanas service live; continuous default/backup AutoDJ and no-gap evidence active. |
| 19.2 | Media Library Pro + rights metadata foundation | DEPLOYED | [#101](https://github.com/Musicutd/ruvanas-platform/pull/101) | `6d1ee67` | Paid auto-deploy | Organisation-owned music, rights declaration/review and shared fail-closed eligibility are live. |
| 19.3 | Smart Playlists | DEPLOYED | [#102](https://github.com/Musicutd/ruvanas-platform/pull/102) | `4ca7812` | Paid auto-deploy | Saved, explainable rules materialise into the existing Music Mode rotation pipeline; paid service verified. |
| 19.4 | Radio Clocks | DEPLOYED | [#103](https://github.com/Musicutd/ruvanas-platform/pull/103) | `98c656b` | Paid auto-deploy | Reusable exact-hour templates reuse schedule, rights and Show Builder primitives; paid service verified. |
| 19.5 | Advanced Scheduler | DEPLOYED | [#104](https://github.com/Musicutd/ruvanas-platform/pull/104) | `962d38c` | `dep-dadfi04s728c73a96evg` | Versioned channel schedules, typed sources, timezone compilation and conflict governance are live on the paid service. |
| 19.6 | Unified Playout Engine | DEPLOYED | [#105](https://github.com/Musicutd/ruvanas-platform/pull/105) | `6d0e674` | `dep-dadgqqvavr4c73at5v5g` | One deterministic priority decision, shared insertions, signed source evidence and explicit fallback alerts are live on the paid service. |
| 19.7 | External Live | DEPLOYED | [#106](https://github.com/Musicutd/ruvanas-platform/pull/106) | `6d9289c` | `dep-dadhls7lk1mc73bh086g` | Provider-neutral live input, encrypted credentials, protected relay, health gating and controlled activation are live on the paid service. |
| 19.8 | DJ Access | DEPLOYED | [#107](https://github.com/Musicutd/ruvanas-platform/pull/107) | `3d9bbeb` | `dep-dadrg8navr4c73alpl0g` | Existing-identity, channel-scoped and time-bounded presenter grants with private-link rotation and immediate revocation are live on the paid service. |
| 19.9 | Live Failover | DEPLOYED | [#108](https://github.com/Musicutd/ruvanas-platform/pull/108) | `e2b0e55` | `dep-dads6817lnhs73ea4m3g` | Health-driven switching, recovery hysteresis, manual override and unified schedule/AutoDJ fallback are live. |
| 19.10 | Browser Live Studio | DEPLOYED | [#109](https://github.com/Musicutd/ruvanas-platform/pull/109) | `b583e41` | `dep-dadsvjks728c73fh0gt0` | Provider-neutral WHIP/WebRTC studio, DJ-grant boundary, local mixer, governed recording and heartbeat fallback are live; publishing remains locked until compatible real-time infrastructure is configured. |
| 19.11 | Voice Tracking / Segue | DEPLOYED | [#110](https://github.com/Musicutd/ruvanas-platform/pull/110) | `1b80f8d` | `dep-dadtnac9v7es73am22rg` | Governed AudioLab render placement, bounded cue/overlap editing, audible three-source preview, approval and Radio Clock binding are live. |
| 19.12 | Audio Processing | DEPLOYED | [#111](https://github.com/Musicutd/ruvanas-platform/pull/111) | `0a9b627` | `dep-dadu69p7lnhs73eblat0` | Versioned broadcast profiles, duplicate-safe worker jobs and measured QC are live on the paid service. |
| 19.13 | Listener Analytics | DEPLOYED | [#112](https://github.com/Musicutd/ruvanas-platform/pull/112) | `d77ea00` | Paid auto-deploy | Privacy-minimised public audience events, duplicate-safe hourly aggregation, bounded retention and protected subscriber reporting are live. |
| 19.14 | Public Player | DEPLOYED | [#113](https://github.com/Musicutd/ruvanas-platform/pull/113) | `8cb2ba9` | Paid auto-deploy | Anonymous, capacity-controlled listening page and embed use the shared playout engine and protected delivery; paid service verified. |
| 19.15 | Listener Interaction | DEPLOYED | [#114](https://github.com/Musicutd/ruvanas-platform/pull/114) | `ab827a6` | Paid auto-deploy | Opt-in requests with moderation, deduplication, rate limits and anonymous-session abuse controls are live. |
| 19.16 | Podcasts | DEPLOYED | [#115](https://github.com/Musicutd/ruvanas-platform/pull/115) | `5f3b7f7` | Paid auto-deploy | Shared series, episode, transcript, RSS and protected-audio core are live; School policy remains intact through its dedicated adapter. |
| 19.17 | Station Website | DEPLOYED | [#116](https://github.com/Musicutd/ruvanas-platform/pull/116) | `6bd9970` | `dep-daekkue7bikc73deslqg` | Public station home, branding, safe now-playing, podcast discovery and verified-domain routing are live. |
| 19.18 | PWA/Mobile | DEPLOYED | [#117](https://github.com/Musicutd/ruvanas-platform/pull/117) | `09c6f09` | `dep-daekne3m8hqs73d5vacg` | Station-branded installability, conservative public-page caching, offline/update state and mobile guidance are live; native stores remain external. |
| 19.19 | Multi-Station Network | DEPLOYED | [#118](https://github.com/Musicutd/ruvanas-platform/pull/118) | `0fd9807` | Paid auto-deploy | Explicit, owner-approved and revocable station/network agreements; no cross-tenant content or operational access. |
| 19.20 | Syndication | DEPLOYED | [#119](https://github.com/Musicutd/ruvanas-platform/pull/119) | `b6d4cd1` | `dep-daemlarm8hqs73d7hsmg` | Recorded and live sharing with source approval, protected delivery, territory and rights-window enforcement. |
| 19.21 | Advertising | DEPLOYED | [#120](https://github.com/Musicutd/ruvanas-platform/pull/120) | `9608d80` | `dep-daenf8h7lnhs73evp1m0` | Station/channel campaigns, Retail Media inventory, bounded break policy, placement readiness and proof-of-play evidence are live. |
| 19.22 | Rights/Royalty reporting | DEPLOYED | [#121](https://github.com/Musicutd/ruvanas-platform/pull/121) | `a9e7a91` | Paid auto-deploy | Authority profiles, work mapping, immutable usage evidence, attestation and bounded CSV exports are live. |
| 19.23 | Distribution | DEPLOYED | [#122](https://github.com/Musicutd/ruvanas-platform/pull/122) | `14b8d49` | Paid auto-deploy | Provider-neutral directory, streaming/CDN, app and voice-assistant adapters are live over the governed integration delivery core. |
| 19.24 | AI Programme Director | DEPLOYED | [#123](https://github.com/Musicutd/ruvanas-platform/pull/123) | `f7dc686` | `dep-daepprs9v7es73bd7kj0` | Explainable local recommendations, separate owner/manager review, provenance and schedule-draft application are live; live publication remains outside the AI workflow. |
| 19.25 | Newsroom | READY TO PUBLISH | — | Local branch | Not deployed | Shared School/Online Radio editorial core, source and revision evidence, assignments, Studio production links and manager-controlled release have passed local verification. |
| 19.26 | Enterprise/Scale | NOT STARTED | — | — | — | Isolation, capacity, SLOs, soak and failover. |

## Dependency rules

1. Stage 19.0 must be accepted before Stage 19.1 is merged.
2. Stage 19.2 establishes the media/right foundations required by smart playlists, clocks, podcasts, advertising, syndication and distribution.
3. Stage 19.6 must land before source-heavy live and failover stages become authoritative.
4. Public listener analytics must define privacy and capacity semantics before the public player is considered complete.
5. External integrations remain adapters; no provider name becomes a core domain model.
6. Retail Radio and School Radio regression coverage is required for every shared-core change.
7. Only a successful paid-service deployment may change a stage status to `DEPLOYED`; the free staging service remains outside the release path.

## Pull-request completion checklist

- [ ] Scope and architecture dependency confirmed.
- [ ] No forbidden duplicated subsystem introduced.
- [ ] Tenant ownership and capability checks documented.
- [ ] Data migration and rollback reviewed.
- [ ] Unit, integration, route-security, database and regression tests pass.
- [ ] Performance coverage added where relevant.
- [ ] CI passes on the public pull request.
- [ ] Pull request merged into `main`.
- [ ] Paid `ruvanas-platform` deployment succeeds on the merge commit.
- [ ] Free staging service remains suspended.
