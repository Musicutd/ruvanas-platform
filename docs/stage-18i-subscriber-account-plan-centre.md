# Stage 18I — Subscriber Account & Plan Centre

Stage 18I gives every subscriber one professional, plain-language place to understand its Ruvanas service, current plan allowances and included products.

## Subscriber experience

- Open **Account & plan** from the subscriber dashboard or task navigation.
- See the effective plan and access state, including paid, trial, grace-period and complimentary arrangements.
- Compare configured stations, players, active streams and protected audio storage with the current allowances.
- Review listener capacity, maximum audio quality and simultaneous-stream availability.
- See which optional products are included: catalogue, uploads, School Radio, public school publishing, Retail Media and Digital Signage.
- Use a direct support route when a plan or service change is needed.

## Financial privacy

- Only the active organisation's owner may see invoice history.
- Managers, content editors and viewers still see plan and operational allowances, but not financial records.
- The page never exposes payment-provider customer IDs, subscription IDs, webhook data or administration controls.
- Complimentary access is clearly described as no-charge access controlled by Ruvanas, not a timed trial.

## Source of truth

- Effective plan and product access are derived from the existing entitlement and billing-state services.
- Usage is read from tenant-scoped stations, enrolled players, active listener leases and stored-audio totals.
- Invoice data is selected directly by active organisation ID and is limited to the six latest records.
- No billing mutation, automatic upgrade, cancellation or payment collection is introduced by this stage.

## Verification

- Unit coverage checks role privacy, customer-facing status language, currency safety, usage meters and feature resolution.
- Source checks ensure tenant derivation, owner-only invoice access, absence of provider identifiers, accessible progress elements and responsive styling.
- The full application test, static verification and production build remain the release gates.
