import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { listCorrectionsNetwork } from "@/lib/corrections-network-service";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, ...await listCorrectionsNetwork(access, new URL(request.url).searchParams.get("facilityId")) }); }
  catch (error) { return correctionsError(error); }
}
