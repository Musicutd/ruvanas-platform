import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { getSessionFromToken, SESSION_COOKIE } from "@/lib/session-lookup";
import { createRewardsContextLoader } from "./context-loader.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { requireRewardShopperAccess, SHOPPER_COOKIE } from "./shopper-access.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { readCheckoutPolicy } from "./checkout-contracts.mjs";
import { createRewardCheckoutService } from "./checkout-service.mjs";
import { createCheckoutHttp } from "./checkout-http.mjs";
import { rewardsDenied } from "./errors.mjs";

async function loaders() {
  const store = await cookies(), shopperToken = store.get(SHOPPER_COOKIE)?.value;
  return {
    loadShopper: db => requireRewardShopperAccess({ db, env: process.env, token: shopperToken }),
    loadContext: createRewardsContextLoader({ db: prisma, authenticate: getSessionFromToken,
      token: store.get(SESSION_COOKIE)?.value, env: process.env })
  };
}
export async function loadRewardCheckoutService() {
  return createRewardCheckoutService({ db: prisma, env: process.env, ...await loaders() });
}
async function authorizeShopper() {
  if (!readCheckoutPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  return (await loaders()).loadShopper(prisma);
}
async function authorizeStaff(locationId) {
  if (!readCheckoutPolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  const { loadContext } = await loaders();
  if (locationId) return requireRetailRewardsAccess({ action: "REDEEM", locationId }, {
    env: process.env, loadContext, ...createRewardsDatabaseAdapter(prisma)
  });
  // Identity only for the locations list's principal throttle. The service
  // rechecks REDEEM at each exact candidate shop before exposing its name.
  // Requiring READ here would incorrectly block a REDEEM-only cashier.
  const context = await loadContext(prisma);
  const s = context?.session, u = context?.user, m = context?.membership;
  if (!s || !u || s.userId !== u.id || s.revokedAt !== null || !(s.expiresAt instanceof Date) || s.expiresAt <= new Date()) return rewardsDenied("UNAUTHENTICATED");
  if (u.privatePreviewAccess != null || !m || m.userId !== u.id || m.organisationId !== s.activeOrganisationId ||
    ![m.id, m.organisationId, u.id].every(value => rewardIdSchema.safeParse(value).success)) return rewardsDenied("FORBIDDEN");
  return { ok: true, organisationId: m.organisationId, userId: u.id };
}
export const checkoutHttp = createCheckoutHttp({
  env: process.env, authorizeShopper, authorizeStaff, loadService: loadRewardCheckoutService,
  rateLimit: ({ request, operation, principal }) => consumeRateLimit({
    key: principal ? `rewards-checkout-${operation}:${principal}` : createRateLimitKey(`rewards-checkout-${operation}-ip`, request),
    limit: principal ? (["wallet", "staffLocations"].includes(operation) ? 60 : 20) : 60, windowMs: 60_000
  })
});
export async function loadShopperWalletPage() {
  return (await checkoutHttp.wallet(new Request("http://localhost/api/rewards/claims", { headers: new Headers(await headers()) }))).json();
}
export async function loadStaffCheckoutPage() {
  return (await checkoutHttp.staffLocations(new Request("http://localhost/api/retail-rewards/checkout/locations", { headers: new Headers(await headers()) }))).json();
}
