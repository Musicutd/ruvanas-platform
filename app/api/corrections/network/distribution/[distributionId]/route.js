import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { withdrawCorrectionsDistribution } from "@/lib/corrections-network-programming-service";

export const dynamic = "force-dynamic";

export async function DELETE(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, distribution: await withdrawCorrectionsDistribution(access, params.distributionId) }); }
  catch (error) { return correctionsError(error); }
}
