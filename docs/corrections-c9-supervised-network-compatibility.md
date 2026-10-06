# Ruvanas Inside C4 and C7 Compatibility

The C9 change locally verified on 6 October 2026 allows a Corrections Guard-approved supervised submission to enter C7's private network workflow without normal Studio pre-approval. It does not approve, schedule or distribute a contributor submission automatically. **Local test results do not replace exact-head GitHub CI, review or release approval.**

## Approval boundary

C4 contributor output remains an immutable, exact Studio render with its PromoVersion **IN_REVIEW**, including after Corrections Guard approval. C7 previously applied that Guard check and then required the same version to be APPROVED, making the supervised path impossible. The new exception exists only inside `approvedCorrectionsNetworkSource`, after the existing Guard scheduling gate passes.

The exception requires the supervised source-kind marker, complete contributor/session/project/version references, matching snapshot revision and policy versions, and the unchanged render/media/promo/checksum fingerprint. The historical session must be submitted, completed and not revoked, with the same organisation, facility, programme, contributor and accountable supervisor. Version and render creation must satisfy C4's original activation boundary. Current contributor access is not granted by these checks: an expired submitted session can retain its reviewed evidence, including a valid submission whose commit finished just after expiry.

Network quality still requires PASSED QC, ready organisation-owned media, matching PromoVersion media and an active owned PromoAsset. Attached approved source versions must remain current for supervised content, including a separately pinned older revision; unavailable or trashed sources fail closed. Central/target policy, territory, rights and explicit network permissions remain enforced.

Ordinary Studio handoff and legacy C3 sources retain their existing APPROVED/PASSED requirement and current-approved-version rule. Existing C7 legacy pinned-version behavior is preserved. No shared Studio approval, schema, migration, catalogue, entitlement, contributor capability or unrelated product route was changed.

## Validation results

The application change was tested as an uncommitted patch based on `ec19141d0c10f3309fc3ac8f0b137718e2a6cf49`, not as a new published commit. Its application-file SHA-256 was `c38337bf1dd471ad7fee3e76d6acff860adab23311f2754a5d35e1f3fbf38666`; fresh Next build ID `XpYrDZJsdzS8YBqfMXX8T` was checked against that source before the API test.

- Ten behavioral source tests passed, covering supervised current/pinned sources, historical expiry, near-expiry completion, legacy controls, missing reviews/QC, identity/evidence/policy drift, source withdrawal and target restrictions. The actual source service ran with real policy helpers and read-only synthetic query dependencies.
- The complete local unit suite passed **1,157 tests**, with **eight database-only skips** and no failures. All **37 registration/catalogue tests** passed. Prisma generation/validation, the build and static integrity checks passed.
- The new real HTTP regression passed against a fresh, verified loopback-only PostgreSQL 18 database and the source-matched web build. It exercised C4 session activation and contributor submission, pending-review denial, supervisor/contributor self-approval denial, independent Guard approval, separate syndication offer/acceptance, explicit distribution/window creation and protected range delivery to the selected receiving facility.
- The same HTTP case denied missing syndication acceptance, contributor distribution and foreign targeting. Trashed sources, changed fingerprints and missing session links disappeared from the private manifest. Distribution withdrawal blocked the old media URL and further completed-proof claims while retaining the earlier test evidence.

The HTTP fixture simulates a completed immutable Studio render and submits **synthetic signed proof**. It is a database/API compatibility regression, not evidence that a worker rendered new audio or that anyone heard it. The earlier [local playback test](corrections-c9-local-playback-storage-validation.md) remains separately attributed to its original code head; human audibility, uninterrupted continuity and live provider recovery were not verified there either.

## Release status

The new fixture runs through the existing integration-test glob. At completion of the local validation, the patch was uncommitted and unpublished; these results are not GitHub CI evidence. Verify the exact published head and its checks in Draft PR #218 before release review. The local application/store ports and the fresh database port were closed after the test. Only generated fictional fixture records were cleaned up; the migration-created baseline and earlier lab evidence were preserved.

No production/demo deployment or migration, Render setting, DNS, email or paid resource changed. The public Coming Soon cover was untouched. C8 physical acceptance and the other [launch requirements](corrections-c9-launch-checklist.md) remain open; local compatibility success is not launch approval.
