import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { addCorrectionsRehabToProgramme } from "@/lib/corrections-rehabilitation-service";

export async function POST(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { const input = await request.json(); const { programmeId } = await params; return correctionsResponse({ ok: true, item: await addCorrectionsRehabToProgramme(access, programmeId, String(input.contentId || "")) }, 201); }
  catch (error) { return correctionsError(error); }
}
