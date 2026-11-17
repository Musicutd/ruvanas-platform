import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { getSessionFromToken, SESSION_COOKIE } from "@/lib/session-lookup";
import { createRewardsContextLoader } from "./context-loader.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { readReversalPolicy } from "./reversal-contracts.mjs";
import { createRewardReversalService } from "./reversal-service.mjs";
import { createReversalHttp } from "./reversal-http.mjs";
import { rewardsDenied } from "./errors.mjs";
async function loader() {
  const store = await cookies();
  return createRewardsContextLoader({ db: prisma, authenticate: getSessionFromToken,
    token: store.get(SESSION_COOKIE)?.value, env: process.env });
}
export async function loadRewardReversalService() {
  return createRewardReversalService({ db: prisma, env: process.env, loadContext: await loader() });
}
async function authorizeStaff(locationId) {
  if (!readReversalPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  const loadContext = await loader();
  if (locationId) return requireRetailRewardsAccess({ action: "REVERSE", locationId }, {
    env: process.env, loadContext, ...createRewardsDatabaseAdapter(prisma)
  });
  // Identity and role ceiling for throttling only. Each returned location is
  // independently checked against current REVERSE authority by the service.
  const context = await loadContext(prisma), s = context?.session, u = context?.user, m = context?.membership;
  if (!s || !u || s.userId !== u.id || s.revokedAt !== null || !(s.expiresAt instanceof Date) ||
    !Number.isFinite(s.expiresAt.getTime()) || s.expiresAt <= new Date()) return rewardsDenied("UNAUTHENTICATED");
  if (u.privatePreviewAccess != null || !m || !["OWNER", "MANAGER"].includes(m.role) || m.userId !== u.id ||
    m.organisationId !== s.activeOrganisationId || ![m.id, m.organisationId, u.id].every(value => rewardIdSchema.safeParse(value).success)) return rewardsDenied("FORBIDDEN");
  return { ok: true, organisationId: m.organisationId, userId: u.id };
}
export const reversalHttp = createReversalHttp({ env: process.env, authorizeStaff, loadService: loadRewardReversalService,
  rateLimit: ({ request, operation, principal }) => consumeRateLimit({
    key: principal ? `rewards-reversal-${operation}:${principal}` : createRateLimitKey(`rewards-reversal-${operation}-ip`, request),
    limit: principal ? (operation === "locations" ? 60 : 20) : 60, windowMs: 60_000
  })
});
export async function loadRewardCorrectionsPage() {
  return (await reversalHttp.locations(new Request("http://localhost/api/retail-rewards/reversals/locations", { headers: new Headers(await headers()) }))).json();
}
