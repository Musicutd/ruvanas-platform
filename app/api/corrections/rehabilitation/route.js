import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { createCorrectionsRehabContent, listCorrectionsRehabilitation } from "@/lib/corrections-rehabilitation-service";
import { rehabilitationDeliveryDetails } from "@/lib/corrections-delivery-service";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { const data = await listCorrectionsRehabilitation(access, new URL(request.url).searchParams.get("facilityId")); const delivery = await rehabilitationDeliveryDetails(access.organisationId, data.content.map((item) => item.id)); return correctionsResponse({ ok: true, ...data, content: data.content.map((item) => ({ ...item, delivery: delivery.get(item.id) || { scheduled: 0, delivered: 0, deliveredSeconds: 0, deliveryEvents: [] } })) }); }
  catch (error) { return correctionsError(error); }
}

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, content: await createCorrectionsRehabContent(access, await request.json()) }, 201); }
  catch (error) { return correctionsError(error); }
}
