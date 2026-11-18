# RR-06c — Historical campaign associations in reports

Local, unpublished candidate. Rewards and registration remain disabled in production. Neither encoder, audio configuration nor another tenant is part of this work.

## Merchant behaviour

Client Admin reports provide two views for one authorised shop and date range: coupon claims and redemption receipts. Each row shows its issued coupon version and either the campaign association recorded with that version or “No campaign linked”. Changing or clearing a later coupon draft does not rewrite earlier rows. Campaign names and promotional recording names come from the immutable publication snapshot, not the current campaign.

The association says which promotion was linked when the coupon version was published. It does not establish that a shopper heard audio, visited a shop, purchased anything, or was influenced by the campaign. No conversion rate or attributed revenue is calculated.

## Read contract

`reportQuerySchema` and `reportExportSchema` accept `view: CLAIMS | REDEMPTIONS`; omission retains the earlier redemption view. Query pagination applies to the selected view. Both cohorts remain independently bounded at 1,000 rows across at most 31 calendar dates, with the existing reporting-retention and 15-minute cutoff checks.

The response includes `view`, `claims`, and `receipts`; the inactive array is empty. Summary counts retain their prior definitions: claims issued in the period, receipts recorded in the period, corrections attached to those receipts through the cutoff, and net uses. A receipt may belong to a claim issued outside the selected period. Summary cohorts must not be used as a conversion calculation.

Claim rows expose only a claim reference, issue time, immutable offer title, issued revision, issued shop name, and `campaignAssociation`. Receipt rows retain their existing receipt/correction fields and add the same association. Its only fields are `campaignName`, `promoName`, and `campaignRevision`; an absent historical pin is null. No shopper/staff identity, claim credential, campaign identifier, configuration hash, media location, target-shop list or payment detail is disclosed.

The join uses the claim's exact `(organisationId, offerId, revision)` and its immutable published coupon snapshot. The campaign pin must match that identity and its saved shop set must match the issued terms. Malformed, foreign or inconsistent associations fail closed. Never infer a link from a current coupon revision, a saved draft choice, a current campaign, a timestamp overlap or a proof-of-play record.

## Permissions and export

The existing main Rewards and reports gates control access. Historical reporting does not require campaign editing or checkout to be enabled. VIEW_INSIGHTS remains necessary for the selected shop; CSV additionally requires EXPORT for the same shop. Existing role ceilings, membership checks, current-authority rechecks, strict request/response schemas and private no-store headers remain in effect.

Each view has a corresponding safe CSV filename and columns. Existing receipt columns are retained, with campaign fields appended. Claims use their own columns. Formula-leading text is neutralised and the existing 2 MiB download limit remains. Neither report nor export mutates coupon, claim, receipt, correction, campaign, grant or audio records; HTTP rate-limit bookkeeping remains the only expected database write.

## Verification and release

No schema, migration, dependency or live-setting change is required. Local evidence must cover old unlinked claims, new linked revisions, subsequent campaign/draft changes, historical corrections, exact tenant/shop scoping, malformed pins, independent date cohorts, pagination, CSV injection, revoked/expired authority, built-route behaviour and actual React desktop/mobile use. A disposable local PostgreSQL database contains only synthetic fixtures. Record actual test results separately; this contract is not proof that tests ran.

Publication, production migration of earlier candidates, live Rewards activation, paid memberships and a public launch remain separate work. Keep production registration closed and both encoders untouched.
