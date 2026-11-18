import { shopperHttp } from "@/lib/retail-rewards/shopper-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request, context) {
  const { shopSlug } = await context.params;
  return shopperHttp.shop(request, shopSlug);
}
