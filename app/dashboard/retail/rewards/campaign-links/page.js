import { notFound } from "next/navigation";
import { readCampaignLinkPolicy } from "@/lib/retail-rewards/campaign-link-contracts.mjs";
import CampaignLinksClient from "./CampaignLinksClient";
export const dynamic = "force-dynamic";
export const metadata = { title: "Optional coupon campaign · Ruvanas Rewards", robots: { index: false, follow: false } };
export default async function RewardCampaignLinksPage() {
  if (!readCampaignLinkPolicy(process.env).enabled) notFound();
  const { loadRewardCampaignLinksPage } = await import("@/lib/retail-rewards/campaign-link-server");
  const result = await loadRewardCampaignLinksPage();
  return <CampaignLinksClient initialData={JSON.parse(JSON.stringify(result))} />;
}
