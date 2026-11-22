import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { requireRewardShopperAccess, SHOPPER_COOKIE } from "./shopper-access.mjs";
import { createShopperSavedWalletService } from "./shopper-saved-wallet-service.mjs";
import { createShopperSavedWalletHttp } from "./shopper-saved-wallet-http.mjs";

async function loader() {
  const store = await cookies(), token = store.get(SHOPPER_COOKIE)?.value;
  return db => requireRewardShopperAccess({ db, env: process.env, token });
}
export const shopperSavedWalletHttp = createShopperSavedWalletHttp({ env: process.env,
  authorize: async () => (await loader())(prisma),
  loadService: async () => createShopperSavedWalletService({ db: prisma, env: process.env, loadShopper: await loader() }),
  rateLimit: ({ request, operation, access }) => consumeRateLimit({
    key: createRateLimitKey(access ? `rewards-saved-wallet-${operation}` : "rewards-saved-wallet-auth", request, access?.shopperId || "anonymous"),
    limit: access ? 60 : 120, windowMs: 60_000
  })
});
