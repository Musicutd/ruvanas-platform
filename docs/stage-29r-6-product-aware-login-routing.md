# Stage 29R.6 — Product-aware login routing

## Outcome

Successful sign-in now returns a server-authoritative destination derived from the active organisation's effective product entitlements. The browser no longer assumes that every subscriber should open the generic dashboard.

## Landing decisions

| Account state | Destination |
| --- | --- |
| One active Retail Radio product | `/dashboard/retail` |
| One active School Radio product | `/dashboard/school` |
| One active Online Radio product | `/dashboard/radio` |
| Two or three active products | `/dashboard` product chooser |
| Valid organisation membership but no active product | `/dashboard/account?reason=service-activation` |
| Subscriber without an organisation membership | `/register` |
| Student | `/school-student` |
| Super Admin or Support | `/admin/stations` |

Product detection uses the same effective entitlement resolver as dashboard and route authorization. Billing service state remains separate from product ownership, and an inactive service cannot produce a product landing route.

## Stability and security

- The login API selects the same first membership used to initialise a new session and resolves that organisation's plan, billing and complimentary-access state.
- The server returns only the recommended destination; it does not disclose capability or billing details in the login response.
- The login page follows the server decision and retains `/dashboard` only as a defensive fallback for an older response.
- Multi-product organisations keep the shared chooser instead of receiving an arbitrary product preference.
- Accounts with no active product receive a clear Account & Plan explanation rather than being sent into an unavailable product.
- Existing password verification, rate limiting, session security and security-event logging remain unchanged.

## Validation coverage

Automated tests cover Retail-only, School-only, Online-only, two-product, three-product, inactive-service, no-product, no-membership, student, Super Admin and Support outcomes. Static contract checks ensure the login UI follows the server recommendation and the account page exposes the activation explanation.

## Operational boundary

This milestone adds no schema or migration change and does not create QA tenants. Stage 29R.7 remains responsible for controlled three-tenant creation and Tier 1–5 acceptance evidence.
