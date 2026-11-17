import { dormantShopperHttp } from "@/lib/dormant-shopper-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request) { return dormantShopperHttp.run(request); }
