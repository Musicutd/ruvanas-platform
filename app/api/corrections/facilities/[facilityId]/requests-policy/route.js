import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { setCorrectionsRequestPolicy } from "@/lib/corrections-requests-service";

export async function PATCH(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { const { facilityId } = await params; return correctionsResponse({ ok: true, policy: await setCorrectionsRequestPolicy(access, facilityId, await request.json()) }); }
  catch (error) { return correctionsError(error); }
}
