# Ruvanas Inside C9 Local Playback and Storage Validation

On 6 October 2026, the isolated C9 workflow completed real upload, audio-worker rendering, changes/resubmission, staff review, explicit scheduling and browser-generated completion. The request became **Played only after matching COMPLETED evidence**. Local database and media recovery checks passed for the tested fictional organisation. **Real-facility launch remains blocked.**

## Environment and attribution

The web application was rebuilt from C9 code head `ec19141d0c10f3309fc3ac8f0b137718e2a6cf49`, with Next build ID `DSeczRrtSO5L5CjcUXapv`. The audio worker ran the same source revision. An earlier cached-build trial was excluded from this exact-head evidence.

The fresh PostgreSQL 18 cluster, application and memory-backed S3 test adapter listened only on `127.0.0.1`, at ports 5549, 3189 and 9189. The database's actual data directory, address, port, database name, user and initial emptiness were verified before migrations. This differs from CI's PostgreSQL 16 environment. The adapter served only the configured fictional organisation and bucket; it was not R2 or another cloud provider.

Only synthetic tones, fictional identities and example.invalid addresses were used. Inherited cloud, email, payment and GitHub credentials were excluded from the runtime. No CI identity was spoofed. The public catalogue in the local database retained seven families and 35 public tiers, with five per family; the fixture's extra plan was non-public.

## Verified workflow

| Check | Result |
| --- | --- |
| Supervised recording | Real multipart contributor upload; full and range-protected reads matched the uploaded WAV bytes. |
| Rendering | The actual audio worker produced two immutable outputs. Protected output reads matched their recorded SHA-256 values. |
| Initial submission | Revision 1 linked the contributor, facility, supervised session, project, exact Studio version and render. It entered review without prior normal Studio approval. |
| Changes requested | A distinct staff reviewer requested changes. A new supervised session used the same project and submitted a new Studio version/render as revision 2. The original render, submission and review history remained intact. |
| Authority | Contributor self-review and scheduling were denied. Request approval before Corrections Guard approval was denied. |
| Approval | A different authorised staff member approved revision 2. Guard approval did not schedule playback or change the normal Studio PromoVersion from IN_REVIEW. |
| Scheduling | Staff separately screened, approved and scheduled a PROGRAMME request through the C5 API, respecting the minimum five-minute lead time. Its private player intent pinned revision 2's media. |
| Browser delivery | The real enrolled browser fetched that protected media and generated accepted STARTED and COMPLETED events. No fixture posted playback proof manually. |

The request remained Scheduled before completion. STARTED was recorded at 07:05:48 Malta time; COMPLETED at 07:06:12, at position 12 seconds, matched the same player, schedule item and approved media. Only then was the request Played. The browser's audio element was observed playing the matching media at 10.22 of 12 seconds.

The control check briefly paused and resumed playback. This does **not** establish uninterrupted audible continuity. Human audibility was not tested: the user confirmed they were not listening during this run. After completion, the local web and worker processes were stopped before recovery copying; the player's subsequent connection error reflects that deliberate local shutdown, not a production failure.

## Local recovery and failure coverage

An archive created from this lab was restored into a new, verified empty database on the same owned cluster. Eight selected snapshot groups matched, including programme/request state, pinned submissions, reviews, accepted proof, media and audit history. Four distinct nonempty media objects, totalling **769,712 bytes**, matched restored database references, sizes and original recording/render checksums. The source and restored media snapshots matched. The object store was frozen for the copy, and an additional reference verification checked the recovered files independently.

These checks cover the tested fictional organisation and local byte files, not every media reference in the cluster, an external backup system, a second recovery host, production data or R2 restoration. They establish no customer recovery-time or data-loss target.

All 21 focused recording, cleanup, inventory and transaction safety tests passed, as did four local-store tests covering scope/ranges, limits, frozen mutations and an in-flight PUT at the freeze boundary. Ambiguous database acknowledgements and cleanup uncertainty remain synthetic handler/unit scenarios; this run did not inject a real database transport failure or validate live provider cleanup.

The web, worker, memory store and PostgreSQL test server were stopped. Independent checks confirmed ports 3189, 9189 and 5549 were closed. Fictional database files and restricted test archives remain local and must not be published as PR artifacts.

## C4 and C7 compatibility gap

The supervised Guard evidence path requires its exact PromoVersion to remain **IN_REVIEW**, including after Corrections approval. C7's `approvedCorrectionsNetworkSource` first invokes that Guard check and then requires the same output to be **APPROVED**. These predicates cannot both hold for this supervised output. This gap was confirmed by code review and the tested retained IN_REVIEW state; C7 distribution was not executed in this Tier 2 fixture.

C5 private request delivery passed without changing normal Studio approval. The subsequent [additive compatibility change](corrections-c9-supervised-network-compatibility.md) passed local source and real API tests against its own source-matched build. It was unpublished at completion of that local validation and is not release-approved; verify its exact published head and CI separately. These later results do not change the attribution of this earlier playback run. Do not promote the version globally or weaken ordinary Studio handoff to bypass the conflict, and keep the new network workflow excluded from customer use pending its release gates.

## Release boundary

This run changed no production/demo service, database, Auto-Deploy setting, DNS, email or paid resource, and published or merged no code. C8 physical acceptance, live provider storage/recovery, applicable interruption/withdrawal/failure cases, independent security review, production rollout rehearsal and first-facility policy/acceptance remain required. See the [launch checklist](corrections-c9-launch-checklist.md) and [release ledger](corrections-c9-release-readiness.md).
