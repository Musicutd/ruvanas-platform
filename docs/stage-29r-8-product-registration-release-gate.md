# Stage 29R.8 Product Registration Release Gate

## Release outcome

Stage 29R.8 closes the product-aware registration update with one explicit release gate for Retail Radio, School Radio and Online Radio. It adds no new customer data and does not change plan prices or entitlements. The gate proves that the implementation built during Stages 29R.2–29R.7 remains coherent before wider beta testing.

## Automated evidence

The release pipeline now requires all of the following on one clean checkout and disposable database:

1. repository text integrity and production dependency audit;
2. protected-media toolchain and performance-index checks;
3. Prisma client generation and schema validation;
4. forward-only migration deployment followed by a clean migration-history status;
5. the complete unit and regression suite;
6. a successful production application build;
7. a locally started production server;
8. targeted product registration, entitlement, routing and controlled Product QA policy tests;
9. the complete database-backed Retail, School and Online Radio integration suite, including all fifteen product/tier QA combinations;
10. non-destructive smoke tests, performance baseline and enterprise isolation checks.

Any failed step stops the gate. The acceptance runner remains restricted to a loopback application and disposable local database so it cannot be pointed at customer or production data.

## Product registration smoke coverage

The release smoke now verifies the normal registration page and valid pricing deep links for Retail Professional, School Create and Online Professional. It also confirms that unauthenticated users cannot open any product dashboard, the Product QA control centre, or its tier-switch endpoint.

## Accountable wider beta sign-off

The existing Super Admin Launch readiness page now includes a separate Product registration matrix accepted confirmation. The operator records a safe evidence reference only after the three controlled QA organisations have passed:

- correct single-product login routing;
- wrong-product dashboard denial;
- Tier 1–5 plan and Licensed Music Catalogue boundaries for each product;
- immediate entitlement updates after controlled tier switching;
- three-way tenant isolation; and
- zero billing contracts and invoices created by the QA path.

The Launch readiness page links directly to Product QA so the evidence can be reviewed before sign-off. Automated health, recovery and release blockers remain authoritative; a manual confirmation cannot override them.

## Rollback and deployment boundary

If CI, migration status, build, local smoke or the Product QA matrix fails, do not merge or deploy the release. Correct the failure on the release branch and rerun the complete gate. If a newly deployed paid release fails the non-destructive live checks, use the paid service's controlled rollback to the last verified merge commit and withdraw the matching launch sign-off.

Only the paid `ruvanas-platform` service may receive an approved release. The free staging service must remain suspended and untouched.

## Definition of done

- The complete CI workflow passes, including clean migration status and production build.
- The final acceptance command reports five passed evidence groups.
- The product registration deep-link and protected-route smoke checks pass.
- The three controlled QA organisations complete the fifteen-tier matrix without billing activity.
- A Super Admin can record or revoke the product-registration confirmation and can finalize wider beta sign-off only after every automated and operator gate is clear.
- Rollback and paid-service-only deployment boundaries are documented.
