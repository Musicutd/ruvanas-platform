import { checkoutHttp } from "@/lib/retail-rewards/checkout-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request, context) { return checkoutHttp.credential(request, (await context.params).claimId); }
