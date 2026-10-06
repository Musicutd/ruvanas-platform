# Ruvanas Inside C9 Launch Checklist and First Facility Pilot Plan

Reviewed on 5 October 2026. The fictional demo is available for potential-customer demonstrations. **Real facility use is not approved yet.** This checklist records tested work, remaining acceptance requirements and a proposed first-facility plan; it grants no authority to merge, migrate, deploy or enable customers.

## Current evidence

| Scope | Verified result | Limit |
| --- | --- | --- |
| C9 code at `ec19141` | [All three GitHub checks passed](https://github.com/Musicutd/ruvanas-platform/actions/runs/37348925292), including disposable-database regressions and the recovery rehearsal. | Not a production or independent security approval. |
| Product catalogue and access | Seven families: Retail, School, Online Radio, Health, Faith, Organisations and Corrections. Exactly 35 public tiers, five per family. Fresh local checks passed: 37 catalogue/registration tests and 55 foundation, access, session, navigation, streaming-admin and recovery tests. | Code and test evidence, not live acceptance of every product. |
| Fictional demo at `2323508` | [Demo CI passed](https://github.com/Musicutd/ruvanas-platform/actions/runs/37354776316). On 5 October it deployed Live after the exact-resource and synthetic-only check, demo migration and guarded seed. Tour returned 200; four registration pages returned 404 and four account-creation endpoints returned 403. | No real facility, audio, player, object storage or customer policy was provisioned. |
| Production | The 5 October dashboard observation showed `bff07f3`, Auto-Deploy Off and Maintenance Mode enabled. Both public domains continued to show Coming Soon. | No Inside production deployment or migration occurred. These are dated observations. |

PRs #217, #218, #220 and #221 were open and Draft when checked. C9 and the demo exclude C8. The separate combined branch at `c4dc840` passed [four CI jobs](https://github.com/Musicutd/ruvanas-platform/actions/runs/37349168128); that does not pass physical Edge acceptance. Complete identifiers and earlier evidence remain in the [detailed ledger](corrections-c9-release-readiness.md).

On 6 October, an [isolated local C9 workflow](corrections-c9-local-playback-storage-validation.md) passed real upload/render, changes/resubmission, separate Guard approval, explicit C5 scheduling and browser-generated completion. Selected database records and four referenced media objects also survived a local restore. Live provider recovery and uninterrupted human-audible playback remain unverified. The C4-to-C7 conflict identified at that base revision now has an [additive compatibility fix](corrections-c9-supervised-network-compatibility.md), with passing local behavioral and real API regression tests. The fix was unpublished at completion of local validation; verify the exact published head and CI results in Draft PR #218 separately. It is not release-approved. No launch gate below is automatically cleared by these local results.

## Requirements before real facility use

Every unchecked item needs attributable evidence for the chosen release and environment. A passing test or this document cannot check these boxes automatically.

- [ ] **Security and permissions.** Complete an independent, isolated review of tenant/facility grants, contributor expiry and revocation, self-approval denial, version-pinned review, privileged actions and historical/private-source isolation. Exercise ordinary six-product controls as well as denial cases. Record findings and their resolution; this repository review is not security certification.
- [ ] **Live playback and delivery.** For the agreed pilot features, witness authorised staff scheduling of an approved exact version on the intended private player/zone. Match accepted completion evidence to that playback. Test failed/interrupted/offline playback, withdrawal and safe return without unrelated public fallback. Include Central/Local and Priority/Emergency only if included in the approved scope. Stored synthetic proof and STARTED events alone are not delivery.
- [ ] **Storage and recovery.** Validate the actual approved media-store upload, ambiguous-save/cleanup and failure paths. Reconcile historical retained objects without automatic deletion. Verify a current restorable database and media backup, recovery ownership, monitoring and agreed maximum data-loss/restoration targets. CI restored a disposable database and local synthetic bytes, not production or the live media store.
- [ ] **Migration and runtime rollout.** Review every pending migration from the actual deployed baseline, not just the demo's new foreign key. Obtain approval for aggregate-only production preflight, check existing pack orphans and table activity, and rehearse the full sequence on an isolated production-shaped database. Measure locking/write interruption, prepare timeouts and recovery actions, then seek separate rollout authority. Never delete or reassign rows to make a migration pass. Verify web and required workers run the same approved commit and report healthy heartbeats.
- [ ] **Facility policies and service scope.** A real authority must agree roles, content/music rights, privacy, retention, legal holds, evidence preservation, approved regions/subprocessors and service/support targets. Counts-only inventory and generic deletion vetoes are not an implemented Corrections retention or legal-hold system. If the agreed policy needs additional controls, implement and validate them before collecting affected data. No periods or regions are approved by this checklist.
- [ ] **Operator and customer acceptance.** Record the named facility's acceptance and the accountable release decision. Use the current six operator confirmations: merge/acceptance evidence, product-registration matrix, approved paid-service deployment and migration, live smoke, the named `ruvanas-platform-staging` service remaining suspended, and business/legal approval. The separate fictional demo is not that staging service. Existing legacy registration evidence must be supplemented with the seven-family catalogue and the intended Corrections access cases.

Read the [foreign-key preflight](corrections-c9-studio-pack-fk-preflight.md), [recovery limitations](corrections-c9-recovery-rehearsal.md) and [storage inventory](corrections-c9-studio-storage-inventory.md) before planning those checks. Restricted inventory reports are not public PR attachments or permission to dispose of data.

## Features that remain excluded

**C8 Edge and offline continuity:** not accepted. A future cloud-only pilot would need explicit agreement that it has no Edge/offline continuity guarantee; excluding Edge does not waive the other checks above. For an offline promise, complete the two-computer private-LAN, trusted-TLS and genuine cloud-disconnection test before separate C8 review and release.

**Live SSO:** disabled. Password/session access may be proposed only if the facility accepts it and its recovery/access controls pass review. A provider is not required for this fictional demo. If a customer requires SSO, the live integration must be implemented, verified and exercised before use; draft provider records are insufficient.

**C7 distribution of supervised C4 output:** the additive local fix passed source/API tests while retaining normal Studio approval. Keep this workflow out of customer use until the exact published change passes GitHub CI, review and the controlled release gates.

**Corrections machine APIs and automated retention deletion:** not provided by the current foundation. Do not promise them or reuse generic organisation scopes/deletion controls as substitutes.

**External broadcast connectors:** no provider-confirmed shutdown is established. Exclude them from proposed Inside use and review applicable historical connections/source assignments before release. A local ENDED flag does not prove external audio stopped. Existing ordinary-product functionality must be preserved.

## Proposed first facility pilot

This is a proposal, not approved provisioning. Begin with one named facility, one zone and a small named staff group, using only features allowed by its selected plan. Player count, duration and service targets remain to be agreed. Before a real facility exists, continue fictional demonstrations and synthetic testing; do not invent its policies.

| Decision | Required value before provisioning |
| --- | --- |
| Customer and authority | Legal customer, named facility, authorised sponsor and policy approver |
| Access | Owner, facility manager, supervisor, reviewer, contributors, support and recovery owners; approved grants |
| Content | Approved sources, Corrections music use/territory and central/facility restrictions |
| Data | Allowed data types, approved retention/hold/preservation rules and actual hosting/media/backup regions |
| Operations | Zones/players, peak load, support contacts, incident response, acceptable interruption and recovery targets |
| Release | Exact code/environment, acceptance evidence, accountable decision maker and stop/recovery criteria |

1. **Agree scope first.** Obtain the missing decisions above, choose a valid plan, explicitly exclude Edge/SSO/APIs/deletion features that are not accepted, and agree the intended workflows and acceptance cases.
2. **Validate in isolation.** Use synthetic audio and data to complete the applicable security, real storage/playback, failure and recovery checks. Do not copy production/customer data or credentials into CI or the fictional demo.
3. **Approve the runtime and rollout separately.** Decide how restricted pilot access will coexist with the public Coming Soon cover. The current maintenance setting blocks production access; do not disable it as an incidental step. Never convert the synthetic-only demo database into a real-customer environment. No new service, paid plan, public exposure, production preflight, migration or deployment is authorised here.
4. **Provision and accept only after those gates pass.** With separate authority, create only the approved customer, facility, grants, policies and player/zone assignments. Observe submission, independent review, changes/resubmission and explicit scheduling. Approval alone must not broadcast; only matching completion evidence can support delivery claims.
5. **Stop on a failed boundary.** Wrong-facility access, unapproved playback, false delivery, unverifiable backup or loss of monitoring blocks expansion. Pause the affected pilot operation, preserve evidence, and follow the approved incident/recovery plan; do not purge data or reverse schema changes blindly.

The immediate next action is to use the fictional demo with potential customers and gather the first facility's requirements while the remaining technical acceptance is prepared. There is no new pillar to build in this documentation step, but unresolved acceptance findings or customer-required integrations may still require code. No launch date or additional spending is committed.
