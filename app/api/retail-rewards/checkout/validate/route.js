import { checkoutHttp } from "@/lib/retail-rewards/checkout-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = request => checkoutHttp.validate(request);
