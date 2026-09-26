import { correctionsProgrammeFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { getCorrectionsProgramme, submitCorrectionsProgramme } from "@/lib/corrections-programmes-service";

export async function POST(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const programme = await getCorrectionsProgramme(access, params.programmeId);
    if (!programme || !await correctionsProgrammeFacilityAccess(access, programme.facilityId, "SUBMIT")) return correctionsResponse({ error: "Programme not found or unavailable." }, 404);
    const { renderId } = await request.json().catch(() => ({}));
    if (typeof renderId !== "string" || !renderId) return correctionsResponse({ error: "Choose a verified Studio render." }, 400);
    const submission = await submitCorrectionsProgramme(access, params.programmeId, renderId);
    return correctionsResponse({ ok: true, submission }, 201);
  } catch (error) { return correctionsError(error); }
}
