import { campaignReviewHttp } from "@/lib/retail-rewards/campaign-review-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = request => campaignReviewHttp.review(request);
