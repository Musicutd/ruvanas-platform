import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { correctionsContributorDevelopment, saveCorrectionsMilestone } from "@/lib/corrections-development-service";

export async function GET(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { const { contributorId } = await params; return correctionsResponse({ ok: true, ...(await correctionsContributorDevelopment(access, contributorId)) }); }
  catch (error) { return correctionsError(error); }
}

export async function PATCH(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { const { contributorId } = await params; return correctionsResponse({ ok: true, milestone: await saveCorrectionsMilestone(access, contributorId, await request.json()) }); }
  catch (error) { return correctionsError(error); }
}
