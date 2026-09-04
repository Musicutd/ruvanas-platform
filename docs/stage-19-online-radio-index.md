# Stage 19 — Online Radio roadmap index

## Baseline

- Architecture baseline: `origin/main` at `49ff8cd`
- Architecture gate: Stage 19.0
- Detailed audit: [`stage-19-0-online-radio-architecture-audit.md`](./stage-19-0-online-radio-architecture-audit.md)
- Status values: `NOT STARTED`, `IN DESIGN`, `IN DEVELOPMENT`, `PR OPEN`, `MERGED`, `DEPLOYED`, `BLOCKED`

> A stage is `DEPLOYED` only when its commit is on `main` and the paid Ruvanas service reports a successful deployment of that commit. Branches and open pull requests are not live releases.

## Roadmap

| Stage | Scope | Status | PR | Main commit | Paid deployment | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 19.0 | Online Radio architecture and reuse audit | MERGED | [#100](https://github.com/Musicutd/ruvanas-platform/pull/100) | `49ff8cd` | Not required | Documentation-only safety gate accepted. |
| 19.1 | 24/7 AutoDJ | DEPLOYED | [#99](https://github.com/Musicutd/ruvanas-platform/pull/99) | `cf848f0` | `dep-dadcptijnfac73eeqj8g` | Paid Ruvanas service live; continuous default/backup AutoDJ and no-gap evidence active. |
| 19.2 | Media Library Pro + rights metadata foundation | IN DEVELOPMENT | — | — | — | Organisation-owned music, rights declaration/review and shared fail-closed eligibility validated locally; awaiting publication. |
| 19.3 | Smart Playlists | NOT STARTED | — | — | — | Saved, explainable rules feeding rotations. |
| 19.4 | Radio Clocks | NOT STARTED | — | — | — | Reuse schedule and Show Builder primitives. |
| 19.5 | Advanced Scheduler | NOT STARTED | — | — | — | Channel targets and typed programme sources. |
| 19.6 | Unified Playout Engine | NOT STARTED | — | — | — | Single authoritative source-priority resolver. |
| 19.7 | External Live | NOT STARTED | — | — | — | Provider-neutral live input foundation. |
| 19.8 | DJ Access | NOT STARTED | — | — | — | Scoped, time-bounded presenter grants. |
| 19.9 | Live Failover | NOT STARTED | — | — | — | Health-driven source switching and evidence. |
| 19.10 | Browser Live Studio | NOT STARTED | — | — | — | Requires external real-time media infrastructure. |
| 19.11 | Voice Tracking / Segue | NOT STARTED | — | — | — | Reuse AudioLab, waveform and multitrack. |
| 19.12 | Audio Processing | NOT STARTED | — | — | — | Broadcast profiles on the existing audio worker. |
| 19.13 | Listener Analytics | NOT STARTED | — | — | — | Public audience events, privacy and aggregation. |
| 19.14 | Public Player | NOT STARTED | — | — | — | Anonymous, embeddable station listening. |
| 19.15 | Listener Interaction | NOT STARTED | — | — | — | Requests with moderation and abuse controls. |
| 19.16 | Podcasts | NOT STARTED | — | — | — | Shared podcast core; School policy remains intact. |
| 19.17 | Station Website | NOT STARTED | — | — | — | Public pages, branding, now-playing and domains. |
| 19.18 | PWA/Mobile | NOT STARTED | — | — | — | Installability/offline; native stores remain external. |
| 19.19 | Multi-Station Network | NOT STARTED | — | — | — | Explicit station/network agreements. |
| 19.20 | Syndication | NOT STARTED | — | — | — | Recorded/live sharing with rights windows. |
| 19.21 | Advertising | NOT STARTED | — | — | — | Generalise campaigns and Retail Media inventory. |
| 19.22 | Rights/Royalty reporting | NOT STARTED | — | — | — | Authority-specific reports on an immutable usage ledger. |
| 19.23 | Distribution | NOT STARTED | — | — | — | Provider adapters, directories and platform connectors. |
| 19.24 | AI Programme Director | NOT STARTED | — | — | — | Existing governance and human approval are mandatory. |
| 19.25 | Newsroom | NOT STARTED | — | — | — | Generalise School editorial workflow. |
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
