import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { clearCorrectionsOverride } from "@/lib/corrections-announcements-service";

export async function POST(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, ...await clearCorrectionsOverride(access, (await params).overrideId) }); }
  catch (error) { return correctionsError(error); }
}
