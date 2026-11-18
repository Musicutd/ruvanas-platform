import { offerHttp } from "@/lib/retail-rewards/offer-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function PATCH(request, context) {
  const { offerId } = await context.params;
  return offerHttp.update(request, offerId);
}
