import { shopperAuthHttp } from "@/lib/retail-rewards/shopper-auth-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) { return shopperAuthHttp.login(request); }
