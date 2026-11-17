import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { SESSION_COOKIE } from "@/lib/session-lookup";
import { readPilotAdminPolicy } from "./pilot-admin-contracts.mjs";
import { requirePilotAdminAccess } from "./pilot-admin-access.mjs";
import { createRewardPilotAdminService } from "./pilot-admin-service.mjs";
import { createPilotAdminHttp } from "./pilot-admin-http.mjs";
import { safePilotAdminResult } from "./pilot-admin-dtos.mjs";
import { rewardsDenied } from "./errors.mjs";
import { createPilotAdminContextLoader } from "./pilot-admin-context.mjs";
async function loader() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return createPilotAdminContextLoader({ db: prisma, env: process.env, token });
}
async function authorize(organisationId) {
  if (!readPilotAdminPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  return requirePilotAdminAccess({ env: process.env, loadContext: await loader(), organisationId });
}
async function loadService() {
  return createRewardPilotAdminService({ db: prisma, env: process.env, loadContext: await loader() });
}
export const pilotAdminHttp = createPilotAdminHttp({ env: process.env, authorize, loadService,
  rateLimit: ({ request, operation, principal }) => consumeRateLimit({
    key: principal ? `rewards-pilot-${operation}:${principal}` : createRateLimitKey(`rewards-pilot-${operation}-ip`, request),
    limit: principal ? 15 : 60, windowMs: 60_000
  })
});
export async function loadPilotAdminPage() {
  if (!readPilotAdminPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  try {
    const access = await authorize(); if (!access.ok) return access;
    const result = await (await loadService()).organisations({});
    return result.ok ? safePilotAdminResult("organisations", result) || rewardsDenied("UNAVAILABLE") : result;
  } catch { return rewardsDenied("UNAVAILABLE"); }
}
