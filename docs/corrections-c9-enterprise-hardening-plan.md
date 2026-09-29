# Ruvanas Inside C9 enterprise hardening

## Status and branch boundary

C9 begins from the C7 `main` baseline (`0e1deb3f8a36d18bd19574e17c4b6045b534169e`) on a separate local branch. Draft C8 PR #217 is not included, merged, or waived. This plan is not a release approval. No production deployment or migration is part of C9 planning.

The original specification defines C9 as SSO, advanced API scopes, retention and data-residency options, scale tests, service controls, and formal release readiness. Those are separate work packages. C9 can make progress without C8, but an Inside production launch cannot pass its final gate while Secure Edge remains unvalidated if the deployment promises offline facility service.

## Existing platform controls to reuse

| Concern | Existing foundation | C9 work still needed |
| --- | --- | --- |
| Enterprise sign-in | Organisation-scoped security policy, session limits, revocation, and draft OIDC/SAML provider records (`docs/phase-5e-enterprise-identity-security.md`) | Verified live provider integration and callbacks; no customer has supplied an identity provider, so SSO remains disabled. |
| Service API | Hashed, revocable organisation service-account keys, a bounded identity endpoint, and explicit scope checking (`lib/enterprise-security.mjs`, `lib/service-account-auth.js`) | Corrections-specific operations must be designed as separate, narrowly scoped APIs with facility authority and audit; an organisation read scope must never imply facility control. |
| Retention | Organisation retention policy and non-destructive candidate dry runs (`RetentionPolicy`, `RetentionJob`, `lib/compliance-service.js`) | Corrections-specific data inventory, authority-approved periods, facility/legal-hold exclusions, and reviewed execution design. Do not reuse School hold records or enable deletion by default. |
| Operations and scale | Existing enterprise scale, recovery, player health and proof systems | Synthetic multi-facility load targets, service-control runbooks, recovery exercises, and evidence against agreed service levels. |
| Existing products | Shared tenant, membership, entitlement and product catalogue controls | Regression checks for Retail, School, Online Radio, Health, Faith and Organisations after each C9 change. |

## Independent C9 work sequence

1. **C9A — security and identity contract.** Map staff, authority, facility and service-account permissions; test session expiry/revocation and cross-facility denial. Keep provider records in draft and `ssoRequired` off until an actual customer identity provider is selected, verified and exercised. Do not add a bypass or silently disable password sign-in.
2. **C9B — retention and residency design.** Inventory contributor, family request, Studio submission, review, player-proof, audit and Edge evidence separately. Produce non-destructive candidate previews and legal-hold rules before any deletion executor. Treat residency as a deployment/storage decision, not a label that changes where data is stored.
3. **C9C — scale and service controls.** Define representative facility/player concurrency and recovery targets with an authority or pilot customer. Use isolated synthetic data to test current cloud paths, proof accuracy, safe interruption and failure recovery. Edge fleet and offline-scale claims stay out of scope until C8 is accepted.
4. **C9D — formal readiness.** Gather passing code, migration, security, accessibility, operations and customer-acceptance evidence. Record untested or externally dependent items as blocked, not as passed.

## Decisions that cannot be invented in code

- Identity provider and protocol, verified customer domains, and account-recovery ownership.
- Applicable jurisdiction, contractual retention periods, legal-hold authority, and deletion approval process.
- Required data region, storage region, backups, subprocessors and any private deployment obligation.
- Target facilities, simultaneous players, availability, RPO/RTO, support coverage and service levels.

Until these are supplied, use provider-neutral contracts and tests only. Do not configure live SSO, move data to a claimed region, purge evidence, or claim an enterprise SLA.

## Release gates that remain blocked

- C8 Secure Edge is Draft and lacks the independent appliance/LAN/TLS acceptance required for an offline-facility claim. C9 work must not imply that C8 passed.
- No real justice-customer identity provider has been supplied or verified. SSO cannot be required or marked complete.
- Retention, residency and service-level terms require customer/legal/operations decisions before they can be accepted.
- Production migrations, deployment and enabling customer access remain separately authorised actions. Render production Auto-Deploy must remain off.

## Minimum verification for each C9 implementation slice

Run Prisma generation and migration checks when schema changes; the focused enterprise and Corrections tests; registration, entitlement, catalogue, navigation and six-product regressions; static checks and production build. Exercise tenant/facility denial and prove that an unconfigured feature fails closed. Use only isolated synthetic data for scale testing. Record the exact checks and remaining blockers before proposing any merge.
