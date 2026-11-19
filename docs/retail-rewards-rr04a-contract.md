# RR-04a: private checkout QR and staff scanner

Status: local implementation and verification only. Nothing in this stage enables Rewards, public registration, a live invitation, billing or streaming. Both encoders and all production data stay unchanged.

## Scope

The authenticated shopper can show a temporary QR code alongside the existing manual checkout code. Authorised staff can scan it locally, review the coupon and explicitly confirm redemption. Scanning never redeems a coupon. Public merchant pages, printed offer links and guest claims are outside this stage.

## Transport and authority

- The QR contains exactly `RUVANAS-REWARDS:1:<64-lowercase-hex-token>`. It is not a URL and contains no shopper identity, offer terms or business data.
- `checkoutQrPayload(token)` serialises a valid token; `parseCheckoutQrPayload(value)` accepts only that exact envelope. `parseCheckoutInput(value)` also accepts a raw token, trimming only outer whitespace from manually entered input.
- The code is the existing rotating, short-lived credential. The server stores only its hash. Existing expiry, rotation, exact-shop authorisation, repeat-use limits, idempotency, correction rules and audit records remain authoritative.
- Existing validation and redemption endpoints, schemas and 139 historical migrations remain unchanged. No QR-specific endpoint or database model is added.
- Never open a scanned URL, send frames to a service, put a token in a URL, persist it in browser storage, log it, or include it in evidence artifacts.

## Shopper lifecycle

Generate the image locally with pinned `qrcode@1.5.4`, a four-module quiet zone and high contrast. Keep the manual code and accessible instructions. Show the expiry. Hide and clear both code and QR on expiry, explicit hide, claim change, ineligible claim status, failed refresh or unmount. Prevent a delayed credential request or QR render from restoring a hidden or superseded code. A fresh code invalidates the previous one through the existing server flow.

## Staff lifecycle

Choose an authorised shop before opening the camera. Request only video, and only after an explicit button click. Decode frames locally with pinned `jsqr@1.4.0`; capture at most 640 pixels on the longest side and scan at most four frames per second. Stop after 60 seconds, including permission wait.

Stop all acquired tracks and clear the video on success, cancel, shop change, page hiding, page exit and unmount. If permission resolves after cancellation, immediately stop the late stream. Camera denial, unsupported devices and timeouts leave manual entry available. Emit only safe status codes, never raw camera errors or frame contents.

A successful scan fills the code field and clears any previous review. Staff still click Review coupon, enter any required purchase amount and explicitly confirm redemption. Shop and input changes invalidate the review. Duplicate frame callbacks cannot submit redemption.

## Verification

- Unit tests: strict envelope/manual parsing, independently decoded QR, malformed and oversized input, camera denial/timeout/cancel/success/late-resolution cleanup and bounded frames.
- Actual React browser workflows: shopper QR and expiry/clearing; staff scanner with simulated video frames decoded by the real library; manual fallback; review before confirmation; responsive layout. Simulated video is not physical camera verification.
- Built HTTP routes and owned loopback PostgreSQL: QR round trip into existing validation, rotation, explicit redemption and idempotent retry, feature gates, authentication separation and no-store responses.
- Preserve prior migration/schema hashes and prior database acceptance evidence; do not repeat unchanged fresh/upgrade suites without cause.
- Run relevant tests, static checks and a production build with synthetic environment variables. No real `.env` files or credentials.

## Dependencies and release limits

QR libraries are bundled locally; no CDN or runtime network service is used. Dependency installation disables scripts and does not alter unrelated versions. Review locked versions, licenses and known advisories before release.

Primary references: [node-qrcode](https://github.com/soldair/node-qrcode), [jsQR](https://github.com/cozmo/jsQR). This work introduces no paid service. Production publication, private shopper provisioning and verification on physical camera hardware remain separate release steps.
