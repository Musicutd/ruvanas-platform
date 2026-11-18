import { checkoutHttp } from "@/lib/retail-rewards/checkout-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = request => checkoutHttp.wallet(request);
export const POST = request => checkoutHttp.claim(request);
