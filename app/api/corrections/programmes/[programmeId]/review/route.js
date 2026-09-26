import { correctionsProgrammeFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { getCorrectionsProgramme, reviewCorrectionsProgramme } from "@/lib/corrections-programmes-service";

export async function POST(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const programme = await getCorrectionsProgramme(access, params.programmeId);
    if (!programme || !await correctionsProgrammeFacilityAccess(access, programme.facilityId, "REVIEW")) return correctionsResponse({ error: "Programme not found or unavailable." }, 404);
    const review = await reviewCorrectionsProgramme(access, params.programmeId, await request.json().catch(() => ({})));
    return correctionsResponse({ ok: true, review }, 201);
  } catch (error) { return correctionsError(error); }
}
