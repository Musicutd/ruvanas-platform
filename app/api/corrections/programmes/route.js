import { correctionsProgrammeFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { availableCorrectionsStudioRenders, createCorrectionsProgramme, listCorrectionsProgrammes } from "@/lib/corrections-programmes-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const [programmes, renders] = await Promise.all([listCorrectionsProgrammes(access), availableCorrectionsStudioRenders(access)]);
    return correctionsResponse({ ok: true, programmes, renders, playbackEnabled: false });
  } catch (error) { return correctionsError(error); }
}

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  const body = await request.json().catch(() => ({}));
  if (!await correctionsProgrammeFacilityAccess(access, body.facilityId, "CREATE")) return correctionsResponse({ error: "This facility is unavailable for programme creation." }, 403);
  try {
    const programme = await createCorrectionsProgramme(access, body.facilityId, body);
    return correctionsResponse({ ok: true, programme }, 201);
  } catch (error) { return correctionsError(error); }
}
