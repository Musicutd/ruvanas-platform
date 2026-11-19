import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { readShopperFeaturePolicy } from "./shopper-contracts.mjs";
import { requireRewardShopperAccess, SHOPPER_COOKIE } from "./shopper-access.mjs";
import { createShopperDiscoveryService } from "./shopper-discovery-service.mjs";
import { createShopperDiscoveryHttp } from "./shopper-http.mjs";
import { rewardsDenied } from "./errors.mjs";

async function loader() {
  const store = await cookies();
  const token = store.get(SHOPPER_COOKIE)?.value;
  return db => requireRewardShopperAccess({ db, env: process.env, token });
}

export async function authorizeRewardShopper() {
  if (!readShopperFeaturePolicy(process.env).enabled) return rewardsDenied("FEATURE_DISABLED");
  return (await loader())(prisma);
}

export async function loadShopperDiscoveryService() {
  return createShopperDiscoveryService({ db: prisma, env: process.env, loadShopper: await loader() });
}

export const shopperHttp = createShopperDiscoveryHttp({
  env: process.env, authorize: authorizeRewardShopper, loadService: loadShopperDiscoveryService,
  rateLimit: ({ request, access }) => consumeRateLimit({
    key: createRateLimitKey(access ? "rewards-shopper-discovery" : "rewards-shopper-auth", request, access?.shopperId || "anonymous"),
    limit: access ? 120 : 60, windowMs: 60_000
  })
});

// Server rendering uses the same pre-auth and shopper throttles as API reads.
// This Request is parsed locally; it sends no network request or credentials.
export async function loadShopperDiscoveryPage() {
  const request = new Request("http://localhost/api/rewards/discovery/locations", {
    headers: new Headers(await headers())
  });
  return (await shopperHttp.locations(request)).json();
}
