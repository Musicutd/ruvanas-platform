import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { readCampaignLinkPolicy } from "./campaign-link-contracts.mjs";
import { authorizeRewardCampaignReview } from "./campaign-review-server";
import { loadRewardOfferService, offerHttp } from "./offer-server";
import { createCampaignLinkHttp } from "./campaign-link-http.mjs";
import { rewardsDenied } from "./errors.mjs";

export async function authorizeRewardCampaignLinks() {
  if (!readCampaignLinkPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  return authorizeRewardCampaignReview();
}
export const campaignLinkHttp = createCampaignLinkHttp({ env: process.env,
  authorizeStaff: authorizeRewardCampaignLinks, loadService: loadRewardOfferService,
  rateLimit: ({ request, operation, principal }) => consumeRateLimit({
    key: principal ? `rewards-campaign-link-${operation}:${principal}` : createRateLimitKey(`rewards-campaign-link-${operation}-ip`, request),
    limit: principal ? 20 : 60, windowMs: 60_000
  })
});
export async function loadRewardCampaignLinksPage() {
  const access = await authorizeRewardCampaignLinks(); if (!access.ok) return access;
  return (await offerHttp.list(new Request("http://localhost/api/retail-rewards/offers", {
    headers: new Headers(await headers())
  }))).json();
}
