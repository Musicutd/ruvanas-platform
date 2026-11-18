import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { getSessionFromToken, SESSION_COOKIE } from "@/lib/session-lookup";
import { createRewardsContextLoader } from "./context-loader.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { readReportsPolicy } from "./reports-contracts.mjs";
import { createRewardReportingService } from "./reporting-service.mjs";
import { createReportingHttp } from "./reporting-http.mjs";
import { rewardsDenied } from "./errors.mjs";
async function loader() {
  const store = await cookies();
  return createRewardsContextLoader({ db: prisma, authenticate: getSessionFromToken,
    token: store.get(SESSION_COOKIE)?.value, env: process.env });
}
export async function loadRewardReportingService() {
  return createRewardReportingService({ db: prisma, env: process.env, loadContext: await loader() });
}
export async function authorizeRewardReports(operation = "report", locationId) {
  if (!readReportsPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  const loadContext = await loader(), dependencies = { env: process.env, loadContext, ...createRewardsDatabaseAdapter(prisma) };
  const selected = locationId ? { locationId } : {};
  const view = await requireRetailRewardsAccess({ action: "VIEW_INSIGHTS", ...selected }, dependencies);
  if (!view.ok || operation !== "exportReport") return view;
  const exportAccess = await requireRetailRewardsAccess({ action: "EXPORT", ...selected }, dependencies);
  if (!exportAccess.ok) return exportAccess;
  if (exportAccess.organisationId !== view.organisationId || exportAccess.userId !== view.userId ||
    exportAccess.organisationMemberId !== view.organisationMemberId) return rewardsDenied("FORBIDDEN");
  return view;
}
export const reportingHttp = createReportingHttp({ env: process.env, authorizeStaff: authorizeRewardReports, loadService: loadRewardReportingService,
  rateLimit: ({ request, operation, principal }) => consumeRateLimit({
    key: principal ? `rewards-report-${operation}:${principal}` : createRateLimitKey(`rewards-report-${operation}-ip`, request),
    limit: principal ? (operation === "exportReport" ? 5 : 30) : 60, windowMs: 60_000
  })
});
export async function loadRewardReportsPage() {
  return (await reportingHttp.locations(new Request("http://localhost/api/retail-rewards/reports/locations", { headers: new Headers(await headers()) }))).json();
}
