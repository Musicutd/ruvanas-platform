import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { withdrawCorrectionsNetworkAudioDistribution } from "@/lib/corrections-network-audio-service";

export const dynamic = "force-dynamic";

export async function DELETE(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, ...await withdrawCorrectionsNetworkAudioDistribution(access, params.distributionId) }); }
  catch (error) { return correctionsError(error); }
}
