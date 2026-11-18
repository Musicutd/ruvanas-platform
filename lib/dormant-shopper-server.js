import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { authorizeDormantShopperSession, createDormantShopperService } from "./dormant-shopper-provisioning.mjs";
import { createDormantShopperHttp } from "./dormant-shopper-http.mjs";

export async function authorizeDormantShopperCreation() {
  try { return authorizeDormantShopperSession(await getCurrentSession(), new Date(), process.env); }
  catch { return { ok: false, code: "UNAVAILABLE" }; }
}

export const dormantShopperHttp = createDormantShopperHttp({
  env: process.env,
  authorize: authorizeDormantShopperCreation,
  rateLimit: ({ request, principal }) => consumeRateLimit({
    key: principal ? `dormant-shopper:${principal}` : createRateLimitKey("dormant-shopper-ip", request),
    limit: principal ? 5 : 20, windowMs: 60_000
  }),
  loadService: async () => createDormantShopperService({ db: prisma, loadSession: getCurrentSession, env: process.env })
});
