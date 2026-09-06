import { NextResponse } from "next/server";
import { protectedLiveResponse } from "@/lib/protected-live-response";
import { getRadioSyndicationContext } from "@/lib/radio-syndication-service";
import { loadRadioSyndicationDelivery, recordRadioSyndicationDelivery } from "@/lib/radio-syndication-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const access = await getRadioSyndicationContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const territory = String(request.nextUrl.searchParams.get("territory") || "").trim().toUpperCase();
  if (!territory) return NextResponse.json({ error: "A contracted delivery territory is required." }, { status: 400 });
  const delivery = await loadRadioSyndicationDelivery({ agreementId: params.agreementId, targetOrganisationId: access.organisation.id, territory });
  if (!delivery.ok) return NextResponse.json({ error: delivery.error, reason: delivery.reason }, { status: delivery.status });
  if (delivery.agreement.offer.kind !== "LIVE_RELAY") return NextResponse.json({ error: "This agreement is not for a live relay." }, { status: 409 });
  return protectedLiveResponse(request, {
    streamUrl: delivery.agreement.offer.sourceStation.streamConfig.streamUrl,
    userAgent: "Ruvanas-Syndication-Relay/1.0",
    onDelivery: ({ contentType }) => recordRadioSyndicationDelivery({ agreement: delivery.agreement, actorUserId: access.user.id, deliveryType: "LIVE_RELAY", territory, details: { contentType } })
  });
}
