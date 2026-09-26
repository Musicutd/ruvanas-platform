import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { createCorrectionsDevelopmentModule } from "@/lib/corrections-development-service";

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, module: await createCorrectionsDevelopmentModule(access, await request.json()) }, 201); }
  catch (error) { return correctionsError(error); }
}
