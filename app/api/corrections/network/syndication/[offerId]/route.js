import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { decideCorrectionsSyndication } from "@/lib/corrections-network-syndication-service";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const input = await request.json();
    return correctionsResponse({ ok: true, ...await decideCorrectionsSyndication(access, params.offerId,
      String(input.decision || "").toUpperCase()) }, 200);
  } catch (error) { return correctionsError(error); }
}
