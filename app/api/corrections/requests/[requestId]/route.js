import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { getCorrectionsRequest, reviewCorrectionsRequest } from "@/lib/corrections-requests-service";

export async function GET(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { const { requestId } = await params; const item = await getCorrectionsRequest(access, requestId); return item ? correctionsResponse({ ok: true, request: item }) : correctionsResponse({ error: "Request not found." }, 404); }
  catch (error) { return correctionsError(error); }
}

export async function POST(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { const { requestId } = await params; return correctionsResponse({ ok: true, request: await reviewCorrectionsRequest(access, requestId, await request.json()) }); }
  catch (error) { return correctionsError(error); }
}
