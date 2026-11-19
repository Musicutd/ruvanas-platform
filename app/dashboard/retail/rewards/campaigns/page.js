import { notFound } from "next/navigation";
import { readCampaignReviewPolicy } from "@/lib/retail-rewards/campaign-review-contracts.mjs";
import CampaignReviewClient from "./CampaignReviewClient";
export const dynamic = "force-dynamic";
export const metadata = { title: "Review coupon audio campaigns · Ruvanas Rewards", robots: { index: false, follow: false } };
export default async function RewardsCampaignReviewPage() {
  if (!readCampaignReviewPolicy(process.env).enabled) notFound();
  const { loadRewardCampaignReviewPage } = await import("@/lib/retail-rewards/campaign-review-server");
  const result = await loadRewardCampaignReviewPage();
  return <CampaignReviewClient initialData={JSON.parse(JSON.stringify(result))} />;
}
