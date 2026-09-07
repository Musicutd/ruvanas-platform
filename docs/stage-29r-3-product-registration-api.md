# Stage 29R.3 Product Registration API

Status: **READY TO PUBLISH FOR REVIEW — HOLD PRODUCTION DEPLOYMENT UNTIL 29R.4**

## Outcome

The public registration endpoint now requires an explicit Ruvanas product and tier. It resolves that choice against the authoritative fifteen-plan catalogue and the matching active public database row. The generic `STARTER` fallback has been removed, so client-supplied prices, limits, capabilities and invented tiers cannot create a subscription.

Stage 29R.3 changes the server contract only. The current registration page does not yet submit `product` and `tier`; Stage 29R.4 must update that guided customer journey before this change reaches the paid production service.

## Request contract

`POST /api/auth/register` accepts:

| Field | Rule |
| --- | --- |
| `name` | Required owner name, 1–120 characters |
| `organisationName` | Required organisation name, 1–160 characters |
| `email` | Required valid email address, normalised to lowercase |
| `password` | Required, 8–200 characters, hashed before persistence |
| `product` | Required `RETAIL`, `SCHOOL` or `ONLINE` value |
| `tier` | Required authoritative public plan code or slug |
| `source` | Optional bounded `DIRECT`, `PRICING_PAGE` or `ADMIN_TEST` attribution |

Unknown fields are rejected. Query strings do not establish product access, pricing, limits or Licensed Music Catalogue rights.

## Server-side plan authority

The registration service first resolves `product + tier` through `lib/product-plan-catalogue.mjs`, then loads the corresponding plan by its stable code inside the registration transaction. Registration fails safely when:

- the product or tier is missing or invalid;
- the tier belongs to a different product;
- the database plan is missing, inactive or not public;
- the database product family, public slug or capability flags conflict with the catalogue;
- a Tier 5 Enterprise plan requires a tailored Ruvanas setup.

Tier 5 plans are not self-provisioned. They return a controlled contact message instead of creating an unrestricted Enterprise trial.

## Atomic account creation

One serializable, retry-protected transaction now performs all authoritative writes:

1. verifies that the email is not already registered;
2. verifies the active public database plan;
3. creates the owner user;
4. creates the organisation and collision-resistant slug;
5. creates the owner membership;
6. creates the selected plan-backed 30-day trial subscription;
7. records `ACCOUNT_REGISTERED` audit evidence.

The audit record contains only product family, stable plan code, bounded registration source and trial state. It does not contain the password, password hash, arbitrary query data or supplier information. Existing origin policy, rate limiting, password hashing, session creation and duplicate-registration protections remain in force.

## Response contract

A successful `201` response returns the user and organisation identifiers, the selected plan summary, trial status and expiry, and one recommended landing route:

| Product | Route |
| --- | --- |
| Retail / In-house Radio | `/dashboard/retail` |
| School Radio | `/dashboard/school` |
| Online Radio | `/dashboard/radio` |

The endpoint does not itself make product pages accessible; the explicit entitlement and route-isolation work remains Stage 29R.5.

## Automated coverage

Tests protect:

- required and normalised request fields;
- bounded registration attribution;
- unknown-field rejection;
- invalid product and tier rejection;
- product/tier mismatch rejection;
- inactive and misconfigured plan rejection;
- Enterprise self-service refusal;
- atomic Retail, School and Online account creation;
- correct plan IDs, trial dates and dashboard routes;
- safe audit payloads without password material;
- duplicate-email concurrency retry behaviour;
- existing product catalogue, entitlement and complimentary-access semantics;
- integration fixtures updated to use explicit product registration.

## Release sequence

The branch may be published and reviewed independently. Do not merge and deploy it to the paid Ruvanas service until Stage 29R.4 is ready in the same production release, because the currently deployed registration form does not yet send the newly required product and tier fields.

The free staging service remains suspended and is not required for this milestone.

## Next milestone

Stage 29R.4 will create the guided service and tier selector, preserve valid pricing-page deep links, show the selected plan summary, submit this API contract, follow the returned dashboard route, and cover mobile and accessibility behaviour.
