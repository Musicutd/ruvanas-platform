import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { getSessionFromToken, SESSION_COOKIE } from "@/lib/session-lookup";
import { createRewardsContextLoader } from "./context-loader.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { readCampaignReviewPolicy } from "./campaign-review-contracts.mjs";
import { createRewardCampaignReviewService } from "./campaign-review-service.mjs";
import { createCampaignReviewHttp } from "./campaign-review-http.mjs";
import { rewardsDenied } from "./errors.mjs";
async function loader() {
  const store = await cookies();
  return createRewardsContextLoader({ db: prisma, authenticate: getSessionFromToken,
    token: store.get(SESSION_COOKIE)?.value, env: process.env });
}
export async function loadRewardCampaignReviewService() {
  return createRewardCampaignReviewService({ db: prisma, env: process.env, loadContext: await loader() });
}
export async function authorizeRewardCampaignReview() {
  if (!readCampaignReviewPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  const loadContext = await loader(), dependencies = { env: process.env, loadContext, ...createRewardsDatabaseAdapter(prisma) };
  const read = await requireRetailRewardsAccess({ action: "READ" }, dependencies); if (!read.ok) return read;
  const manage = await requireRetailRewardsAccess({ action: "MANAGE_OFFERS" }, dependencies); if (!manage.ok) return manage;
  if (manage.organisationId !== read.organisationId || manage.userId !== read.userId || manage.organisationMemberId !== read.organisationMemberId)
    return rewardsDenied("FORBIDDEN");
  return read;
}
export const campaignReviewHttp = createCampaignReviewHttp({ env: process.env, authorizeStaff: authorizeRewardCampaignReview, loadService: loadRewardCampaignReviewService,
  rateLimit: ({ request, operation, principal }) => consumeRateLimit({
    key: principal ? `rewards-campaign-review-${operation}:${principal}` : createRateLimitKey(`rewards-campaign-review-${operation}-ip`, request),
    limit: principal ? 20 : 60, windowMs: 60_000
  })
});
export async function loadRewardCampaignReviewPage() {
  return (await campaignReviewHttp.offers(new Request("http://localhost/api/retail-rewards/campaign-review/offers", { headers: new Headers(await headers()) }))).json();
}
