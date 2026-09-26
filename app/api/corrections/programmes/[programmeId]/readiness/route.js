import { correctionsProgrammeFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { correctionsProgrammeReadiness, getCorrectionsProgramme } from "@/lib/corrections-programmes-service";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const programme = await getCorrectionsProgramme(access, params.programmeId);
    if (!programme || !await correctionsProgrammeFacilityAccess(access, programme.facilityId)) return correctionsResponse({ error: "Programme not found." }, 404);
    const readiness = await correctionsProgrammeReadiness(access, params.programmeId);
    return correctionsResponse({ ok: true, readiness });
  } catch (error) { return correctionsError(error); }
}
