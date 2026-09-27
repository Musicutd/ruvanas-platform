import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { createCorrectionsDistribution } from "@/lib/corrections-network-programming-service";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, ...await createCorrectionsDistribution(access, await request.json()) }, 201); }
  catch (error) { return correctionsError(error); }
}
