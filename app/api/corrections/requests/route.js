import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { createInternalCorrectionsRequest, listCorrectionsRequests } from "@/lib/corrections-requests-service";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  const params = new URL(request.url).searchParams;
  try { return correctionsResponse({ ok: true, requests: await listCorrectionsRequests(access, Object.fromEntries(params)) }); }
  catch (error) { return correctionsError(error); }
}

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, request: await createInternalCorrectionsRequest(access, await request.json()) }, 201); }
  catch (error) { return correctionsError(error); }
}
