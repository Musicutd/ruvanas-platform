import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { SHOPPER_COOKIE } from "./shopper-access.mjs";
import { createShopperAuthService } from "./shopper-auth-service.mjs";
import { createShopperAuthHttp } from "./shopper-auth-http.mjs";

export const shopperAuthHttp = createShopperAuthHttp({
  env: process.env,
  loadService: async () => createShopperAuthService({ db: prisma, env: process.env }),
  getToken: async () => (await cookies()).get(SHOPPER_COOKIE)?.value,
  rateLimit: ({ request, operation, identity }) => {
    let key = createRateLimitKey(`shopper-auth-${operation}-ip`, request);
    if (identity !== undefined) {
      const secret = process.env.SESSION_SECRET;
      if (typeof secret !== "string" || secret.length < 32) throw new Error("Authentication unavailable.");
      key = `shopper-auth-${operation}-identity:${createHmac("sha256", secret).update(`shopper-rate:v1:${operation}:${identity}`).digest("hex")}`;
    }
    return consumeRateLimit({ key, limit: identity === undefined ? 20 : 10, windowMs: 15 * 60 * 1000 });
  }
});
