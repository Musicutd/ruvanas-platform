# Stage 29R.7 — Controlled Product QA Tenants and Tier Switching

## Release outcome

Stage 29R.7 adds a Super Admin-only control centre for exercising each Ruvanas product through its five public tiers. It covers Retail Radio, School Radio and Online Radio while preserving product isolation and preventing the QA workflow from creating billing events.

This release does not add permanent credentials, real email addresses or customer data to source control.

## Controlled QA organisations

| Product | Required organisation name | Starting plan | Expected landing page |
| --- | --- | --- | --- |
| Retail Radio | `Ruvanas Retail QA` | Retail Professional (Tier 3) | `/dashboard/retail` |
| School Radio | `Ruvanas School QA` | School Pro (Tier 3) | `/dashboard/school` |
| Online Radio | `Ruvanas Online Radio QA` | Online Professional (Tier 3) | `/dashboard/radio` |

Use Ruvanas-controlled email aliases and passwords held in the approved credential manager. Create each account independently through the normal registration journey. Never put those identities or passwords in repository files, issue comments, screenshots or test fixtures.

## Operator workflow

1. Sign in as a Super Admin.
2. Open **Customers & business → Product QA**.
3. Confirm all three designated organisations are present and show **Verified**.
4. Select Tier 1, 2, 3, 4 and 5 in turn for each product.
5. After each switch, sign in as that QA owner and confirm:
   - the login lands on the correct product dashboard;
   - the other two product dashboards redirect to Account & Plan;
   - Account & Plan shows the selected plan and current limits;
   - onboarding remains product-specific;
   - the Licensed Music Catalogue level is `NONE` for Tiers 1–2, `FOCUSED` for Tier 3, `PROFESSIONAL` for Tier 4 and `PREMIUM` for Tier 5;
   - organisation switching cannot cross the tenant boundary.
6. Return each organisation to its approved Tier 3 starting plan after the acceptance pass.

## Safety boundary

The tier switch is allowed only when all of these conditions remain true:

- the organisation has one of the three exact QA names;
- the operator is a Super Admin;
- the subscription status is `TRIAL`;
- no billing contract is attached;
- no complimentary-access code is attached or active;
- the target plan is active, public and belongs to the QA organisation's product family.

The switch clears product and optional-feature overrides so the selected catalogue plan remains authoritative. Each successful operation records `PRODUCT_QA_TIER_SWITCHED`, the previous and next plan, the verified landing route and catalogue level, and an explicit `billingEventCreated: false` marker.

## Automated acceptance evidence

The release suite creates short-lived test identities at runtime in the disposable CI database. Random passwords are generated in memory and are never written to source. The route-level test then performs all 15 tier switches and proves:

- correct product access and wrong-product denial;
- deterministic login routing after every switch;
- plan and limit visibility in Account & Plan;
- Tier 1–5 Licensed Music Catalogue policy;
- three-way tenant isolation;
- one audit event for every switch;
- zero billing contracts and zero billing invoices for the QA organisations.

## Rollback

If the QA control centre fails acceptance, do not use it against persistent QA accounts. Revert this application release. Existing customer subscriptions are unaffected because the endpoint cannot operate on an ordinary, billed, complimentary or active subscription.
