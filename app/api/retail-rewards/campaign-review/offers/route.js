import { campaignReviewHttp } from "@/lib/retail-rewards/campaign-review-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = request => campaignReviewHttp.offers(request);
