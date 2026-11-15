import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { createPilotLoginService } from "@/lib/retail-rewards/pilot-login-service.mjs";
import { createPilotLoginHttp } from "@/lib/retail-rewards/pilot-login-http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPilotLoginHttp({ env: process.env,
  loadService: async () => createPilotLoginService({ db: prisma, env: process.env }),
  rateLimit: ({ request, identity }) => consumeRateLimit({
    key: identity ? `rewards-pilot-login-account:${identity}` : createRateLimitKey("rewards-pilot-login-ip", request),
    limit: identity ? 10 : 20, windowMs: 15 * 60 * 1000
  }) });
