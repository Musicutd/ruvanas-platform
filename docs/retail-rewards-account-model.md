# Ruvanas account roles and Rewards shopper journey

## Confirmed product direction

On 14 November 2026, the project owner clarified three account categories: Super Admin, Client Admin and Shopper / Subscriber. In Rewards product language, a subscriber is the shopper using coupons. A business using Ruvanas is a client, with its own Client Admin and client plan.

This clarification changes no live account, permission, charge or feature flag. RR-01b's disabled database and access foundation was deployed on 13 November; the later shopper and coupon journeys described below are local candidates, not part of that deployed release.

## Account categories

| Category | Purpose and access |
| --- | --- |
| Super Admin | The Ruvanas project owner administers the platform back office and core administration across all pillars, client organisations, plans, feature configuration and platform reporting. Cross-client support and management operations must be explicit and audited. |
| Client Admin | A shop owner, school administrator or other client administrator manages their own organisation and its enabled pillars. For Rewards, this includes their business profile, shops, categories, offers, terms, staff and own redemption reports within assigned permissions. It grants no access to another client's private records or platform administration. |
| Shopper / Subscriber | A consumer browses participating businesses and their offers, claims or saves coupons, presents them for redemption and manages their own profile, membership and usage history. It grants no client administration, music catalogue administration or platform access. |

Cashiers, store managers and other staff are scoped roles beneath a client organisation; they are not an additional top-level customer category. They may receive permission to validate coupons without permission to edit offers or manage the organisation.

These categories describe access contexts, not a rule that every person must have exactly one role. If a person is both a client administrator and a shopper, switching context must preserve the separate permissions; consumer login must never imply client or platform authority.

## Shopper experience

The required target journey is: category (for example Fashion, Restaurants or Home) → participating shop → that shop's available coupons → offer terms → claim or save → redemption.

One shop can publish multiple offers. Examples include 15% off everything, a separate 10% offer, or 10% off a purchase of at least €50. Each offer defines its eligible items and shops, minimum spend, validity and usage rules. A repeat-use benefit may permit repeated qualifying purchases, but each redemption is separately validated and recorded. Frequency, total uses and per-shopper limits must be explicit; repeated use must not mean replaying an already-consumed redemption credential.

Categories and approved public shop/offer information can support discovery across participating clients. Private business records, uploaded media, shopper membership details and redemption records remain scoped. A client may access only the customer information necessary for its own authorised Rewards operations, not a shopper's activity at other businesses.

## Client plans and shopper memberships

Keep two distinct concepts in product screens and future services:

- **Client plan:** the organisation's Ruvanas products, features and allowances, including any business Rewards add-on.
- **Shopper membership:** the consumer's Rewards access and coupon eligibility.

The existing Prisma `Subscription` model represents an organisation's client plan. Do not rename, repurpose or attach shopper billing to it as a terminology fix. Shopper identity, membership and any future billing need their own reviewed contracts. This clarification establishes shopper accounts and memberships but does not set free versus paid access, prices, tiers, payment handling or launch dates.

## Implementation boundary

This account model supersedes the earlier assumption that “subscriber” in the owner's Rewards requirements means the merchant. It also makes category-to-shop discovery a confirmed target experience. The original v1 specification placed shared discovery and consumer memberships in later phases; their implementation order must now be reconciled before the next dependent milestone. This is not authorisation to enable the entire network or begin charging shoppers.

Retain the deployed tenant and location boundaries. Implement Super Admin management through explicit platform administration and audited support paths; do not add an implicit bypass to the existing ordinary-client Rewards guard. Client and shopper sessions must never be confused, including through direct URLs, APIs or identifier substitution.

These are product categories, not three newly implemented database roles. Existing `SUPER_ADMIN` and organisation `OWNER` roles can support the first two categories through appropriate workflows. Shopper onboarding must not inherit the current business `OWNER` defaults or automatically create an organisation, staff membership, client subscription or Rewards grant. A shopper presents a coupon; authorised client staff perform the privileged validation/redemption operation.

Before the next code milestone, align the offer model and screens with categories, multiple offers per shop, reusable-benefit rules and the separate shopper journey. Rewards stays disabled until its applicable release and activation gates pass. Registration, streaming, other pillars and approved hosting budgets remain unchanged.

## Local implementation on 14 November 2026

RR-02 supplies the Client Admin offer editor, immutable published revisions, categories and reusable-benefit terms. RR-03a adds the separate Shopper identity foundation and read-only category → shop → coupons → terms journey. Both are local candidates; this note does not establish a deployment or activation.

The Shopper foundation uses its own session and membership records. An active membership currently means explicit internal access only; it does not represent a payment or a client subscription. RR-03b adds private invitation acceptance, password sign-in and shopper-only sign-out as a further local candidate. Its invitation and disabled shopper must already be provisioned, together with an active internal membership; only synthetic fixtures perform that provisioning in this milestone. Invitation issuance/delivery, mailbox verification, account recovery, public signup and billing are not implemented. Possession of an invitation does not establish verified email ownership.

Discovery uses deliberately published shop profiles and separately approved coupon revisions. It never copies private business names, addresses, unpublished drafts or customer records into a public profile. Shops must opt into discovery and retain valid Retail and Rewards access. Withdrawing an opt-in, pausing an offer, changing its published revision or revoking eligibility removes it from subsequent discovery reads.

The shopper flag defaults off and also requires the main Rewards flag. Private authentication additionally requires the separate shopper-auth flag; it also defaults off. The existing private-preview access boundary is unchanged.

RR-03c adds an authenticated local coupon wallet and shop-staff checkout behind the additional default-off checkout flag. A claim pins the published offer terms and shop for at most 24 hours. A five-minute checkout code is issued separately and can be replaced; only its keyed hash is stored. Each claim permits one successful redemption. Reusable offers allow a fresh claim for a later qualifying purchase, subject to the offer's total, per-shopper and daily limits. Counts span all revisions and shops of the same offer, so publishing new terms cannot reset usage. Merchant monthly quotas are also enforced at redemption.

Claims do not reserve stock or remaining uses. Staff review the coupon, enter the eligible purchase amount and explicitly confirm redemption. The server rechecks authority, validity and limits in the same transaction that records the immutable receipt. This records a staff-confirmed coupon redemption, not a payment or independently verified sale. Retries cannot create a second receipt for the same claim.

RR-03d adds a local manager-only correction for a mistaken redemption within 24 hours, behind a separate default-off reversals flag. The selected shop requires current `REVERSE` authority; cashier-only and Shopper accounts cannot correct a redemption. A correction records an immutable reason and actor reference alongside the original receipt. It performs no payment refund or stock adjustment and cannot erase or edit the original purchase record.

Reversing a receipt restores its use against the offer's total, per-shopper and daily limits. The shopper must request a fresh claim, subject to current terms and eligibility; the original claim and checkout code remain consumed. Monthly merchant service quotas continue counting the original successful redemption. The wallet and checkout retry show the correction, including when reversals are subsequently disabled. The deadline is exactly 24 hours after the original redemption; exact successful retries remain readable after that deadline, with current staff authority still required.

The preceding paragraphs record the RR03 milestones. Later local candidates add QR/scanner presentation (RR04a), reports and campaign associations (RR05/RR06), explicit Super Admin pilot provisioning and one-use invitation issuance (RR07b), and Client Admin staff shop/capability assignments (RR07c). QR browser tests use simulated input and do not establish physical-camera compatibility. Invitation delivery, mailbox verification, accepted-shopper recovery, membership pricing and public registration remain outside the candidate.

RR07d adds a read-only readiness checklist and authorised Super Admin navigation. It distinguishes recorded setup, current eligibility and a complete test that still needs verification. Current private-preview authentication is incompatible with ordinary Rewards business and shopper roles; local acceptance uses ordinary authentication mode and must not be mistaken for hosted tester compatibility. No production flag, account, stream, registration setting or subscription was changed. See the individual milestone contracts and evidence for precise behaviour and verification.

RR07e resolves that compatibility gap in the local candidate with an explicit, default-off preview-pilot bridge. Existing ordinary business accounts use a dedicated Rewards sign-in; shoppers retain invitation-only authentication and must belong to an allowlisted pilot enrollment. The bridge admits only reviewed Rewards paths and preserves tenant, staff, membership and session checks. It does not convert current preview owner/tester profiles or enable Rewards on the hosted site. The readiness checklist still does not claim a successful end-to-end test. See `retail-rewards-rr07e-contract.md`.
