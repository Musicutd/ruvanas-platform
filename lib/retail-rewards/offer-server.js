import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionFromToken, SESSION_COOKIE } from "@/lib/session-lookup";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { createRewardsContextLoader } from "./context-loader.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { createRewardOfferService } from "./offer-service.mjs";
import { createOfferHttpHandlers } from "./offer-http.mjs";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";
import { rewardsDenied } from "./errors.mjs";

async function contextLoader() {
  const store = await cookies();
  return createRewardsContextLoader({ db: prisma, authenticate: getSessionFromToken,
    token: store.get(SESSION_COOKIE)?.value, env: process.env });
}

export async function loadRewardOfferService() {
  // This adapter is only called after the route/page feature gate.
  const loadContext = await contextLoader();
  return createRewardOfferService({ db: prisma, env: process.env, loadContext });
}

export async function authorizeRewardOffers(action) {
  if (!readRewardsFeaturePolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  return requireRetailRewardsAccess({ action }, { env: process.env,
    loadContext: await contextLoader(), ...createRewardsDatabaseAdapter(prisma) });
}

export const offerHttp = createOfferHttpHandlers({
  env: process.env,
  authorize: authorizeRewardOffers,
  loadService: loadRewardOfferService,
  rateLimit: ({ request, permission, mutation }) => consumeRateLimit({
    key: createRateLimitKey(mutation ? "rewards-offer-write" : "rewards-offer-read", request, `${permission.organisationId}:${permission.userId}`),
    limit: mutation ? 30 : 120, windowMs: 60_000
  })
});
