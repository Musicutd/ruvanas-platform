import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashSessionToken, SESSION_COOKIE } from "@/lib/session-lookup";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { authorizePilotPreparationSession, PILOT_PREPARATION_SESSION_SELECT } from "./pilot-preparation-context.mjs";
import { pilotPreparationDenied, pilotPreparationInputSchema } from "./pilot-preparation-contracts.mjs";
import { createPilotPreparationService } from "./pilot-preparation-service.mjs";
import { createPilotPreparationHttp } from "./pilot-preparation-http.mjs";

// Read the ordinary session without extending it or using the pilot sign-in bridge.
async function loadPreparationSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  return prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) }, select: PILOT_PREPARATION_SESSION_SELECT });
}

export async function authorizePilotPreparation() {
  try {
    return authorizePilotPreparationSession(await loadPreparationSession(), new Date(), process.env);
  } catch { return pilotPreparationDenied("UNAVAILABLE"); }
}

const service = () => createPilotPreparationService({ db: prisma, loadSession: loadPreparationSession, env: process.env });

export async function loadPilotPreparationPage(organisationId) {
  try {
    const input = pilotPreparationInputSchema.safeParse({ organisationId });
    if (!input.success) return pilotPreparationDenied("INVALID_REQUEST");
    // Reuse the guarded handler in-process: page reloads and API refreshes share
    // the same buckets. This URL describes the request; no network call occurs.
    const response = await pilotPreparationHttp.run({ method: "GET", headers: await headers(),
      url: `http://ruvanas.local/api/admin/retail-rewards/preparation?organisationId=${encodeURIComponent(input.data.organisationId)}` });
    return await response.json();
  } catch { return pilotPreparationDenied("UNAVAILABLE"); }
}

export const pilotPreparationHttp = createPilotPreparationHttp({
  authorize: authorizePilotPreparation,
  rateLimit: ({ request, principal }) => consumeRateLimit({
    key: principal ? `rewards-preparation:${principal}` : createRateLimitKey("rewards-preparation-ip", request),
    limit: principal ? 15 : 60,
    windowMs: 60_000
  }),
  loadService: async () => service()
});
