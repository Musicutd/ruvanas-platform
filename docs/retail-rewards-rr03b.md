# RR-03b private Shopper authentication

Local candidate completed on 14 November 2026. This extends the RR-03a shopper browsing candidate and has not been pushed, deployed, migrated or activated on a live service.

## Implemented

- Private invitation acceptance: a preprovisioned disabled shopper with a current internal membership can consume its one-use invitation and set a password.
- Separate Shopper password login and exact-session logout. Business sessions, organisation roles and client subscriptions do not provide Shopper authority and are not changed by this flow.
- Generic authentication failures, origin checks, bounded request bodies, IP and global identity throttles, dedicated HttpOnly cookies and strict default-off flags.
- Serializably rechecked identity and membership authority. Revoked, expired, consumed or concurrently changed invitations cannot mint new sessions through stale checks.
- Additive credential and invitation tables. Global shopper identity survives merchant reset. No backfill, live shopper provisioning or email delivery.
- Responsive sign-in and invitation screens, with a synthetic preview that stores its sample state only in memory.

## Verification

Evidence is under `output/retail-rewards-rr03b-20261114` in the parent workspace. `verification-summary.json` records the exact sources and individual evidence paths.

| Check | Result |
| --- | --- |
| Rewards and related unit tests | 164 passed; four opt-in database suites skipped in this unit run |
| PostgreSQL authentication acceptance | 34 passed: 17 on a fresh database and 17 after upgrade |
| Migration replay | Fresh 137 migrations and 136 → 137 upgrade; thirteen predecessor rows unchanged; zero authentication backfill |
| Built local HTTP/SSR acceptance | 15 passed, including invitation → login → discovery → logout, cookie isolation and revocation |
| Actual React UI with synthetic transport | Nine workflows passed, including 390px mobile, validation and secret clearing |
| Static checks and production build | Passed; source hashes stable |

The build retained the predecessor's CSS compatibility warnings and expected failed database lookups against the deliberately unreachable loopback build placeholder. Those warnings were not suppressed. Real HTTP/database checks used their own synthetic PostgreSQL instance. The first route-harness attempt could not start PostgreSQL inside the Windows sandbox; the authorized isolated retry passed. Every temporary Next/PostgreSQL process from those runs stopped and released its port. The independent synthetic UI preview remains available at `http://127.0.0.1:65019/`.

All 136 historical migrations were preserved. The prior RR-03a worktree and preview were preserved. Local PostgreSQL 18 acceptance does not replace the PostgreSQL 16 repository CI release gate.

## Remaining boundaries

Invitation issuance/admin provisioning, delivery, email ownership verification, recovery and real pilot access remain to be implemented and reviewed. An invitation proves possession of the code, not ownership of a mailbox. Existing private-preview middleware remains unchanged. Shopper prices and billing are undecided.

Coupon claiming, saving, QR presentation and redemption are not implemented. The next dependent coupon milestone needs explicit expiry, reservation, repeat-use, pause/lapse and transactional redemption rules. Rewards and public registration remain disabled. Neither encoder, stream, other channel, plan nor hosting budget was changed.
