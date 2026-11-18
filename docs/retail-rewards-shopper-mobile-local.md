# Shopper mobile design: local preview

This implements the approved location → shop → voucher design using the real shopper React components. Credit-card-style vouchers display the discount, minimum spend, validity and the current shopper's remaining uses. The server, not the browser, owns redemption counts and eligibility.

## Preview on this computer

From the repository root, with its existing Node dependencies installed:

```sh
node scripts/preview-shopper-mobile.mjs --port 8789
```

Open `http://127.0.0.1:8789/`. The script builds into the ignored `.next/shopper-mobile-preview` directory and serves only static preview assets on the loopback interface. `--build-only` compiles without starting a server. Port `0` chooses a free loopback port and prints its URL.

This preview bundles the actual `ShopperDiscoveryClient` and `ShopperClaimsClient` components. Its sample shops, vouchers, counts and claims live only in browser memory. It does not read environment files, sign in to an account, query a database, invoke production APIs or enable feature flags. The server accepts static GET requests only, and its Content Security Policy blocks network connections. Reloading resets the demo.

Choose Sliema, then Urban Edit. The reusable 10% voucher begins at **7 of 10 uses left**. The 15% voucher is single-use. Opening an offer, obtaining a demo coupon or showing its fake QR does not reduce the count. The separate **Preview controls** panel can simulate a cashier redemption; reopening the voucher then shows 6 uses left. That panel is a local testing aid and is not part of the shopper product. Demo codes have no value and must never be used at a real checkout.

## Browser checks

The browser check uses an isolated, headless browser profile and refuses non-loopback targets. It does not control signed-in Chrome or either encoder. Provide the location of an already-installed Playwright module when it is outside this repository:

```sh
node scripts/check-shopper-mobile-browser.mjs --base-url http://127.0.0.1:8789/ --playwright-module /path/to/playwright/package.json --output /path/to/local-evidence
```

The check covers location selection and search, shop filtering, voucher terms and remaining uses, navigation, demo claim/checkout presentation, narrow mobile layouts and desktop layouts. Screenshots of checkout views mask the fake QR and token. Test artifacts contain no real accounts, credentials or music.

## Release boundary

These are local source changes and a local demo only. They do not change registration, production Rewards flags, invitations, memberships, subscriptions, costs, hosting or either encoder. Rewards remains subject to the existing disabled feature gates. The new UI does not grant permission to activate a shopper or start a hosted pilot. A sample-browser walkthrough is not hosted acceptance or a physical two-device QR test.
