import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { createCorrectionsNetworkWindow, listCorrectionsNetworkWindows } from "@/lib/corrections-network-programming-service";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, windows: await listCorrectionsNetworkWindows(access, new URL(request.url).searchParams.get("facilityId")) }); }
  catch (error) { return correctionsError(error); }
}

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, window: await createCorrectionsNetworkWindow(access, await request.json()) }, 201); }
  catch (error) { return correctionsError(error); }
}
