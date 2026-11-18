import { notFound } from "next/navigation";
import { readRewardsFeaturePolicy } from "@/lib/retail-rewards/feature-policy.mjs";
import { readCheckoutPolicy } from "@/lib/retail-rewards/checkout-contracts.mjs";
import { readReversalPolicy } from "@/lib/retail-rewards/reversal-contracts.mjs";
import { readReportsPolicy } from "@/lib/retail-rewards/reports-contracts.mjs";
import { readCampaignReviewPolicy } from "@/lib/retail-rewards/campaign-review-contracts.mjs";
import { readCampaignLinkPolicy } from "@/lib/retail-rewards/campaign-link-contracts.mjs";
import { readStaffAdminPolicy } from "@/lib/retail-rewards/staff-admin-contracts.mjs";
import { readPilotPreviewPolicy } from "@/lib/retail-rewards/pilot-preview-policy.mjs";
import RewardOffersClient from "./RewardOffersClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retail Rewards · Client Admin | Ruvanas", robots: { index: false, follow: false } };

export default async function RetailRewardsPage() {
  if (!readRewardsFeaturePolicy(process.env).enabled) notFound();
  let canReport = false;
  if (readReportsPolicy(process.env).enabled) {
    const { authorizeRewardReports } = await import("@/lib/retail-rewards/reporting-server");
    canReport = (await authorizeRewardReports()).ok;
  }
  const reportsLink = canReport && <a href="/dashboard/retail/rewards/reports">View shop coupon reports</a>;
  let canCheckout = false, canManageStaff = false;
  if (readCheckoutPolicy(process.env).enabled) {
    const { loadStaffCheckoutPage } = await import("@/lib/retail-rewards/checkout-server");
    const checkout = await loadStaffCheckoutPage();
    canCheckout = checkout.ok && (checkout.locations.length > 0 || checkout.hasMore);
  }
  if (readStaffAdminPolicy(process.env).enabled) {
    const { authorizeRewardStaffAdmin } = await import("@/lib/retail-rewards/staff-admin-server");
    canManageStaff = (await authorizeRewardStaffAdmin()).ok;
  }
  const checkoutLink = canCheckout && <a href="/dashboard/retail/rewards/redeem">Open shop coupon checkout</a>;
  const staffLink = canManageStaff && <a href="/dashboard/retail/rewards/staff">Manage staff access</a>;
  let canLinkCampaigns = false;
  if (readCampaignLinkPolicy(process.env).enabled) {
    const { authorizeRewardCampaignLinks } = await import("@/lib/retail-rewards/campaign-link-server");
    canLinkCampaigns = (await authorizeRewardCampaignLinks()).ok;
  }
  let canReviewCampaigns = false;
  if (readCampaignReviewPolicy(process.env).enabled) {
    const { authorizeRewardCampaignReview } = await import("@/lib/retail-rewards/campaign-review-server");
    canReviewCampaigns = (await authorizeRewardCampaignReview()).ok;
  }
  const { loadRewardOfferService } = await import("@/lib/retail-rewards/offer-server");
  const result = await (await loadRewardOfferService()).list({});
  if (!result.ok) {
    const pilotPreview = readPilotPreviewPolicy(process.env).enabled;
    return <section style={{ padding: 32 }}><h1>Retail Rewards</h1>
      <p>{canCheckout ? "Open checkout to validate coupons at your assigned shops." : result.error}</p>
      <p>{checkoutLink}</p><p>{reportsLink}</p><p>{staffLink}</p>
      <a href={pilotPreview ? "/rewards/pilot-sign-in" : "/dashboard/retail"}>{pilotPreview ? "Back to Rewards pilot sign-in" : "Back to Retail"}</a></section>;
  }
  let canCorrect = false;
  if (readReversalPolicy(process.env).enabled) {
    const { loadRewardCorrectionsPage } = await import("@/lib/retail-rewards/reversal-server");
    const corrections = await loadRewardCorrectionsPage();
    canCorrect = corrections.ok && (corrections.locations.length > 0 || corrections.hasMore);
  }
  return <>
    {canLinkCampaigns && <nav aria-label="Optional coupon campaign" style={{ padding: "16px 32px" }}><a href="/dashboard/retail/rewards/campaign-links">Choose a campaign for the next coupon publication</a></nav>}
    {canReviewCampaigns && <nav aria-label="Coupon campaign review" style={{ padding: "16px 32px" }}><a href="/dashboard/retail/rewards/campaigns">Review audio campaigns for a coupon</a></nav>}
    {canReport && <nav aria-label="Shop reports" style={{ padding: "16px 32px" }}>{reportsLink}</nav>}
    {canManageStaff && <nav aria-label="Rewards staff" style={{ padding: "16px 32px" }}>{staffLink}</nav>}
    {(canCheckout || canCorrect) && <nav aria-label="Shop checkout" style={{ padding: "16px 32px", display: "flex", flexWrap: "wrap", gap: 24 }}>
      {checkoutLink}
      {canCorrect && <a href="/dashboard/retail/rewards/corrections">Correct a redemption</a>}
    </nav>}
    <RewardOffersClient initialData={JSON.parse(JSON.stringify(result))} />
  </>;
}
