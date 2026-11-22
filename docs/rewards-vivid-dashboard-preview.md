# Vivid shopper dashboard: local design candidate

**Historical design milestone.** This document preserves the scope and evidence of the standalone preview. Its statements about future integration, visit-only saves and no schema change describe that earlier milestone, not the current aggregate release candidate. The layout has since been connected locally to the existing shopper services and a persistent saved wallet; see [Connected shopper layout and saved wallet](rewards-connected-shopper-wallet.md) for the current implementation, additive migration and release boundaries. Neither milestone authorises hosted activation or deployment.

22 November 2026. Extends the local shopper categories and savings work based on `456134e406aa07be5b4c610906ad0d0cc63e8723`. This milestone is an interactive, local design preview. It has not replaced a hosted dashboard or been connected to production checkout, account storage or billing.

## Experience

`ShopperVoucherDashboard` and `VividVoucherCard` are reusable React components under `app/rewards`. Six explicit fixture offers demonstrate Dining, Tech, Fashion, Coffee, Entertainment and Wellness, with Ruvanas branding, vivid gradients, EMV-style decoration and contactless decoration. These decorations do not provide card payment or NFC functionality.

The card wrapper keeps a 1.586:1 ratio. Clicking or using the keyboard flips between front and back. The back contains a magnetic-stripe treatment, SVG QR, code copy feedback, saved state and checkout action. Expiry and remaining uses stay visible on the front. Full written terms are available in the checkout dialogue. Reduced-motion mode removes the flip animation and sheen.

Explore now starts with a location choice, followed by a category choice and a dedicated matching-shops page. Shop tiles have distinct fictional logos, shop names, location and voucher counts. Opening one shop displays its profile and only its voucher cards. There is no mixed voucher grid before a shop is selected. Back navigation retains the shop search; changing location or category resets dependent selections. Browse state survives a visit to My Wallet or Stack.

`vivid-shop-browse.mjs` groups already-authorized card data by the exact shop slug and location pair. Names are never treated as identity, and shops with matching names cannot have their vouchers combined. The helpers are presentation filters, not a replacement for server-side authorization. `ShopBrand` uses local SVG wordmarks for the six fictional preview shops, with an initials fallback. Real merchant logos and durable discovery data remain part of later integration.

My Wallet contains saved cards; Stack fans those saved cards with direct selection and previous/next controls. Saving is distinct from claiming or redeeming a voucher. Theme and saved-card state last for this preview visit only; a reload resets the in-memory example. No cross-account browser storage is used. The approved voucher card component and its styles are unchanged by the shop-browsing refinement.

The header's Total saved is the sum of confirmed simulated receipt discounts in EUR. It starts at zero, never a fabricated €185. Preparing, copying, saving, cancelling or showing a QR changes no savings or use count. The explicit **Confirm demo redemption** action simulates shop confirmation, checks the eligible amount and use limits, emits one idempotent receipt, decrements remaining uses and updates the header. A live shopper must never gain authority to confirm a merchant redemption through this UI.

## QR and trust boundary

QR SVG paths come from the installed QR encoder, not a decorative random matrix. The same payload generates the same matrix. Preview payloads use `RUVANAS-DEMO:` and cannot be accepted by the existing checkout parser. Production-format rendering in the reusable helper requires an explicit matching token and a future credential expiry. Offer IDs and printed voucher numbers are never converted to credentials.

The local fixture and simulated merchant-confirmation controls live only in `tests/fixtures/shopper-vivid-preview.*`. They are not imported by production routes. The preview server binds to loopback and allows only static preview GET requests. Its Content Security Policy blocks connections, form submissions, frames and media. It does not read sessions, create accounts, call hosted APIs or process a purchase.

## Release boundary

Before this presentation replaces the live subscriber UI, wire it to authenticated discovery, the existing shopper claim/credential flow and merchant-confirmed receipts. Saved favourites require durable, shopper-scoped server storage; the current visit-only state must not be presented as an account-persistent wallet. Keep existing claimed-voucher history distinct from saved offers. Read real totals from the reviewed savings endpoint, preserving unknown payment evidence and separate currencies. Recheck expiry, current offer terms and usage at checkout through the existing services.

The existing category, wallet and savings route implementation remains in place. No schema, migration, feature flag, registration policy, plan, encoder or hosting service is changed by this preview. No publication or deployment is authorized by this local build.

## Local verification

Run `scripts/preview-shopper-vivid.mjs --port 0` using the project's Node 20 toolchain. `scripts/check-shopper-vivid-browser.mjs` accepts a loopback `--base-url`, installed Playwright module path and evidence `--output`. Tests cover palette mapping, decoding deterministic QR, credential mismatch/expiry rejection, demo receipt arithmetic, duplicate confirmation, repeat-use caps, cancellation, filters, keyboard interaction, themes and responsive card geometry.

Evidence is in the shared workspace at `output/retail-rewards-vivid-dashboard-20261122`. This is design and synthetic behaviour evidence, not hosted pilot acceptance, real payments or physical phone-camera testing.
