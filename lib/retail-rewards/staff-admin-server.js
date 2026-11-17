import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionFromToken, SESSION_COOKIE } from "@/lib/session-lookup";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { createRewardsContextLoader } from "./context-loader.mjs";
import { createRewardStaffAdminService } from "./staff-admin-service.mjs";
import { createStaffAdminHttp } from "./staff-admin-http.mjs";
import { readStaffAdminPolicy } from "./staff-admin-contracts.mjs";
import { safeStaffAdminResult } from "./staff-admin-dtos.mjs";
import { rewardsDenied } from "./errors.mjs";

export async function loadRewardStaffAdminService() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return createRewardStaffAdminService({ db: prisma, env: process.env,
    loadContext: createRewardsContextLoader({ db: prisma, authenticate: getSessionFromToken, token, env: process.env }) });
}
export async function authorizeRewardStaffAdmin() {
  if (!readStaffAdminPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  try { return await (await loadRewardStaffAdminService()).authorize(); }
  catch { return rewardsDenied("UNAVAILABLE"); }
}
export const staffAdminHttp = createStaffAdminHttp({ env: process.env, authorize: authorizeRewardStaffAdmin,
  loadService: loadRewardStaffAdminService,
  rateLimit: ({ request, operation, principal }) => consumeRateLimit({
    key: principal ? `rewards-staff-${operation}:${principal}` : createRateLimitKey(`rewards-staff-${operation}-ip`, request),
    limit: principal ? operation === "overview" ? 60 : 20 : 90, windowMs: 60_000
  })
});
export async function loadRewardStaffAdminPage() {
  if (!readStaffAdminPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  try {
    const result = await (await loadRewardStaffAdminService()).overview({});
    return result.ok ? safeStaffAdminResult("overview", result) || rewardsDenied("UNAVAILABLE") : result;
  } catch { return rewardsDenied("UNAVAILABLE"); }
}
