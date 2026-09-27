import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { deactivateCorrectionsNetworkWindow } from "@/lib/corrections-network-programming-service";

export const dynamic = "force-dynamic";

export async function DELETE(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, window: await deactivateCorrectionsNetworkWindow(access, params.windowId) }); }
  catch (error) { return correctionsError(error); }
}
