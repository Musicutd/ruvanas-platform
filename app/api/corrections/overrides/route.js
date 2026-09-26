import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { startCorrectionsOverride } from "@/lib/corrections-announcements-service";

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, ...await startCorrectionsOverride(access, await request.json()) }); }
  catch (error) { return correctionsError(error); }
}
