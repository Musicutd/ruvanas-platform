import { shopperSavingsHttp } from "@/lib/retail-rewards/shopper-savings-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return shopperSavingsHttp.inspect(request); }
