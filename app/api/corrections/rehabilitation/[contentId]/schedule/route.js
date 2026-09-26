import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { scheduleCorrectionsRehabilitation } from "@/lib/corrections-delivery-service";

export async function POST(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { const { contentId } = await params; return correctionsResponse({ ok: true, delivery: await scheduleCorrectionsRehabilitation(access, contentId, await request.json()) }); }
  catch (error) { return correctionsError(error); }
}
