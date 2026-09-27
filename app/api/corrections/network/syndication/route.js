import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { offerCorrectionsSyndication, listCorrectionsSyndication } from "@/lib/corrections-network-syndication-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, offers: await listCorrectionsSyndication(access) }); }
  catch (error) { return correctionsError(error); }
}

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try {
    const input = await request.json();
    return correctionsResponse({ ok: true, ...await offerCorrectionsSyndication(access, String(input.programmeId || "")) }, 201);
  } catch (error) { return correctionsError(error); }
}
