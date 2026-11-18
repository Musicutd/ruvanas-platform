import { shopperHttp } from "@/lib/retail-rewards/shopper-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return shopperHttp.shops(request); }
