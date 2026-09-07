# Stage 29R.5 — Dashboard isolation and product capability enforcement

## Outcome

Ruvanas now treats Retail Radio, School Radio and Online Radio as independently owned products throughout the subscriber experience. A general active-service state no longer grants either Retail or Online Radio access.

## Product access contract

| Product | Required capability | Subscriber dashboard |
| --- | --- | --- |
| Retail Radio | `retailRadioEnabled` | `/dashboard/retail` |
| School Radio | `schoolRadioEnabled` | `/dashboard/school` |
| Online Radio | `onlineRadioEnabled` | `/dashboard/radio` |

Every product also requires the organisation service to be active. Complimentary access continues to resolve through the effective entitlement layer before these checks are applied.

## Subscriber experience

- Product cards show only products owned by the active organisation.
- The primary sidebar does not mix unavailable products with owned products.
- Online-only station, public-player, website, network, syndication, rights, distribution, newsroom, podcast and listener-analytics links require Online Radio.
- Promotions remain available to Retail or Online Radio, but not to a School-only account.
- The shared player experience uses neutral location and listening-area language instead of Retail-only shop wording.
- Retail Media and Digital Signage remain separately controlled add-ons.

## Direct-access protection

- Retail, School and Online dashboard roots use the same central product decision.
- The complete Online Radio dashboard subtree is protected by an Online Radio layout guard.
- Station creation and station administration pages require Online Radio.
- The School production suite requires School Radio.
- Podcasts and listener analytics enforce Online Radio in both page and API access helpers.
- Station creation, public-player settings, station websites, domains and listener-request moderation enforce Online Radio at the API boundary.
- Platform administrators retain their existing governed operational override; ordinary organisation members must have both membership authority and the product capability.

## Validation coverage

- A broad active-service flag alone grants no product.
- Single-product Retail, School and Online accounts receive exactly one product dashboard.
- A multi-product account receives every explicitly assigned dashboard.
- Navigation tests prevent cross-product leakage.
- Static route checks prove that subscriber pages and Online-specific API paths use explicit product enforcement.
- Existing entitlement, navigation, listener-interaction and subscriber product tests remain part of the regression suite.

## Operational boundary

This stage changes application access control and subscriber presentation only. It adds no database migration, does not change billing records and does not alter deployment configuration.
