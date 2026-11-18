# RR07f — Integrated local browser pilot acceptance

Status: local, unpublished acceptance candidate. Checks in this contract are planned requirements, not completed results. The run's dated evidence must identify which checks actually passed, failed or remain unverified. Hosted Rewards remains disabled, public registration closed and both encoders untouched.

## Purpose and scope

RR07e verified compiled application HTTP behaviour and a synthetic sign-in interface separately. RR07f tests the integrated browser journey through the actual locally built application, its cookies, rendered layouts, navigation and API handlers. It uses synthetic Super Admin, Client Admin, cashier and shopper accounts in an owned disposable PostgreSQL database. It creates no hosted account, invitation, grant, subscription, credential or paid service.

The verified RR07e source is preserved. The RR07f candidate and its build must be pinned before the journey runs; evidence must name that exact candidate. Any narrow interface correction discovered during acceptance needs its own review and relevant checks. The journey does not authorize widening role, tenant, preview or registration boundaries.

## Local transport and sessions

The application, database and HTTPS gateway bind only to loopback. A short-lived self-signed certificate for localhost and 127.0.0.1 is generated for this run, never installed in a browser, operating-system or user trust store, and removed at cleanup. If certificate verification is bypassed, that exception applies only to the isolated test-browser context and its local origin; it is not a production TLS or trust-store change. Browser requests outside the owned local origin must be blocked or fail the acceptance run.

Use actual Chrome with isolated temporary sessions for the different roles, not the user's signed-in browser profile. Synthetic passwords and invitation codes remain local to the run and must not appear in saved evidence, screenshots or logs. The browser should perform genuine form submissions and navigation, preserving normal secure-cookie, same-origin and CSRF checks. Setup may seed synthetic fixtures before testing, but must distinguish fixture preparation from actions performed by the browser.

## Planned acceptance checks

- Super Admin, Client Admin and cashier sign in through the dedicated pilot form and receive their role-appropriate Rewards interface. Ordinary private-preview accounts are not promoted or treated as these identities.
- The invited shopper accepts the invitation, signs in separately, browses categories and shops, reads a coupon's disclosed terms and claims it into the wallet.
- A shopper obtains the short-lived redemption credential; a cashier at an allowed shop validates it, reviews the offer and qualifying purchase, confirms redemption and sees a stable result.
- A reusable coupon can be used only within its disclosed total, per-shopper and daily limits. Verify applicable minimum-spend refusal, safe repeated submission and refusal after the permitted uses are exhausted.
- Logout, session revocation and navigation back to protected pages must not restore server-side authority. Cashier, shopper and business role boundaries and foreign-organisation access remain enforced.
- Check mobile shopper layout and keyboard/manual-code cashier use, including useful error states and safe return navigation. Manual code entry is not proof of physical-camera scanning or scanning between real devices.
- Confirm public registration remains blocked and that the run changes no seeded client plan, subscription or stream fixtures beyond its explicitly prepared synthetic Rewards data. Record cleanup of owned browser sessions, servers, database and ephemeral TLS files.

## Evidence and limits

Save concise results and selected screenshots in `output/retail-rewards-rr07f-20261114` in the surrounding task workspace. Results must distinguish browser actions, setup API calls, direct database assertions and retained earlier evidence. Never count a fixture-only screen or an HTTP request as a completed browser workflow. Readiness configuration remains separate from an end-to-end redemption result.

This milestone does not enable a hosted pilot or remove earlier release obligations. PostgreSQL 16 CI, hosted migration and account-provisioning review, physical cashier-device testing, operational capacity and recovery evidence, commercial/legal approval and explicit launch approval remain separate. The pre-existing frozen-page and historical migration-pin failures recorded in RR07e must stay visible; do not relax their assertions or rewrite frozen artifacts to make this browser milestone pass.
