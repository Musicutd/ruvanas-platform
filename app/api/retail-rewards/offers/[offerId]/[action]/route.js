import { offerHttp } from "@/lib/retail-rewards/offer-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request, context) {
  const { offerId, action } = await context.params;
  return offerHttp.transition(request, offerId, ({ publish: "PUBLISH", pause: "PAUSE", resume: "RESUME", cancel: "CANCEL" })[action]);
}
