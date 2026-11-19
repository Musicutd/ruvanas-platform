import { offerHttp } from "@/lib/retail-rewards/offer-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = request => offerHttp.list(request);
export const POST = request => offerHttp.create(request);
