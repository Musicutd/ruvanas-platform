import { campaignLinkHttp } from "@/lib/retail-rewards/campaign-link-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = request => campaignLinkHttp.review(request);
