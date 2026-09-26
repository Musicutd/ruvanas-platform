import { correctionsProgrammeFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { editCorrectionsProgramme, getCorrectionsProgramme } from "@/lib/corrections-programmes-service";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const programme = await getCorrectionsProgramme(access, params.programmeId);
    if (!programme || !await correctionsProgrammeFacilityAccess(access, programme.facilityId)) return correctionsResponse({ error: "Programme not found." }, 404);
    return correctionsResponse({ ok: true, programme });
  } catch (error) { return correctionsError(error); }
}

export async function PATCH(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const existing = await getCorrectionsProgramme(access, params.programmeId);
    if (!existing || !await correctionsProgrammeFacilityAccess(access, existing.facilityId, "EDIT")) return correctionsResponse({ error: "Programme not found or unavailable." }, 404);
    const programme = await editCorrectionsProgramme(access, params.programmeId, await request.json().catch(() => ({})));
    return correctionsResponse({ ok: true, programme });
  } catch (error) { return correctionsError(error); }
}
