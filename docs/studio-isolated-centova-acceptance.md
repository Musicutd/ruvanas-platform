# Broadcast Console: isolated Centova acceptance plan

This is a **test plan, not a completed playback test**. Keep the existing Radio Test 105 stream and its Ruvanas AutoDJ worker untouched. Do not enable Studio Manual commands for subscribers, publish this branch, or change Render settings on the strength of a green unit test.

## Test boundary and prerequisites

1. Obtain a **separate non-production Centova stream** with its own listener URL, live-source port and source password. A second stream on the same reseller host is acceptable only if both the listener URL and source host/port tuple are different from production. Do not paste passwords into tickets, chat, commands or test evidence.
2. Record the *current* production listener URL and live-source host/port and compare them with the test stream using `node scripts/check-studio-isolated-target.mjs`. Set `STUDIO_TEST_ACK=ISOLATED_TEST_STREAM`, `STUDIO_TEST_LISTENER_URL`, `STUDIO_TEST_SOURCE_HOST`, `STUDIO_TEST_SOURCE_PORT`, `STUDIO_PRODUCTION_LISTENER_URL`, `STUDIO_PRODUCTION_SOURCE_HOST` and `STUDIO_PRODUCTION_SOURCE_PORT` in the local test environment. The check performs **no network connection**, so it cannot validate DNS resolution or audio. It rejects the known Radio Test 105 endpoints even if the current-production comparison is accidentally changed. Independently verify that the test host resolves to the intended provider before connecting any encoder.
3. Use a disposable Ruvanas organisation, station, channel, database and protected-media bucket. Use only **self-owned test tones or speech** cleared for Online Radio; do not use Promo Only, another distributor's catalogue, or production customer media. Keep the test encoder separate from the production worker and never give it the production station ID or source password.
4. Install and syntax-check the exact Liquidsoap version used by the worker image, then run the encoder against the test Centova source. The local Windows checkout currently has neither Liquidsoap nor Docker and cannot perform this step.
5. Before any Manual handoff attempt, finish the priority-aware encoder adapter, event acknowledgements and immediate output-time rights check. The present worker sends **AutoDJ only**; the private Studio queue helper is not connected. The live Manual controls must remain locked until that adapter and independent listener checks pass.

## Acceptance sequence

| Step | Action on the isolated station | Required observation |
| --- | --- | --- |
| 1. Baseline | Play a distinct self-owned AutoDJ test tone. Sample or record the public **test listener URL**, not only the encoder process or Centova status page. | Audible AutoDJ tone, with a timestamped listener recording and matching encoder/lease logs. HTTP 200 alone is insufficient. |
| 2. Manual | Queue a different test tone, confirm a current same-tenant Studio Pro Manual session and rights, then request the handoff. | The listener changes to the Manual tone exactly once. A queue ACK is logged separately from actual encoder output and independent listener evidence. |
| 3. Priority | Introduce an approved higher-priority scheduled programme or live/emergency test event that overlaps the Manual item. | Manual is denied or preempted; the higher-priority source is heard. No gap, duplicate start or mixed source is accepted. |
| 4. Rights change | Revoke/take down the Manual test item or expire its licence during a safe test. | No later Manual start; any active Manual output stops promptly according to the approved interruption policy. No stale cached decision can continue an unlawful play. |
| 5. Fallback | End Manual, empty the queue, disconnect the Manual source, then restart the test encoder. | AutoDJ resumes without operator intervention. Lease ownership stays singular and no second encoder connects simultaneously. |
| 6. Failure | Simulate unavailable authority, lost lease, wrong tenant, malformed item, silent source and Centova reconnect. | Fail closed to permitted fallback; never mark `ON_AIR` or create proof-of-play solely from a queue ACK or HTTP status. |

For each step retain the test station ID, UTC timestamps, safely redacted encoder events, the public-listener recording or objective audio sample, the exact expected tone, the actual observed tone and a pass/fail note. Keep credentials, private media URLs and personally identifying data out of this evidence. Only a verified, correlated listener-output event may support a public-play claim or distributor usage report.

## Stop conditions and release gate

Stop immediately if a target matches production, the test account shares a live source endpoint, rights or tenant checks are uncertain, another encoder owns the lease, protected programming cannot be represented, or the listener sample disagrees with the claimed source. Do not use the production Radio Test 105 stream as a substitute for the isolated test.

The acceptance sequence is **not runnable yet**: there is no attached test stream/container/disposable database, and the Studio Manual-to-Centova adapter is intentionally unwired. `RUVANAS_STUDIO_HANDOFF_SHADOW=1` is a read-only diagnostic, not a switch. Manual start/skip/fade and Broadcast start remain blocked. This document records what must be proven before those controls can be unlocked or the Broadcast Console released.
