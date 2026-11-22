import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { requireRewardShopperAccess, SHOPPER_COOKIE } from "./shopper-access.mjs";
import { createShopperSavingsService } from "./shopper-savings-service.mjs";
import { createShopperSavingsHttp } from "./shopper-savings-http.mjs";

async function loader() {
  const store = await cookies(), token = store.get(SHOPPER_COOKIE)?.value;
  return db => requireRewardShopperAccess({ db, env: process.env, token });
}

export const shopperSavingsHttp = createShopperSavingsHttp({ env: process.env,
  authorize: async () => (await loader())(prisma),
  loadService: async () => createShopperSavingsService({ db: prisma, env: process.env, loadShopper: await loader() }),
  rateLimit: ({ request, access }) => consumeRateLimit({
    key: createRateLimitKey(access ? "rewards-shopper-savings" : "rewards-shopper-savings-auth", request, access?.shopperId || "anonymous"),
    limit: access ? 30 : 60, windowMs: 60_000
  })
});

// SSR and refresh share the same throttle and authorisation path.
export async function loadShopperSavingsPage() {
  const request = new Request("http://localhost/api/rewards/savings", { headers: new Headers(await headers()) });
  return (await shopperSavingsHttp.inspect(request)).json();
}
