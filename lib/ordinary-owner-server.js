import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { authorizeOrdinaryOwnerSession, createOrdinaryOwnerService } from "./ordinary-owner-provisioning.mjs";
import { createOrdinaryOwnerHttp } from "./ordinary-owner-http.mjs";

export async function authorizeOrdinaryOwnerCreation() {
  try {
    return authorizeOrdinaryOwnerSession(await getCurrentSession(), new Date(), process.env);
  } catch {
    return { ok: false, status: 503, code: "UNAVAILABLE" };
  }
}

export const ordinaryOwnerHttp = createOrdinaryOwnerHttp({
  env: process.env,
  authorize: authorizeOrdinaryOwnerCreation,
  rateLimit: ({ request, principal }) => consumeRateLimit({
    key: principal ? `ordinary-owner:${principal}` : createRateLimitKey("ordinary-owner-ip", request),
    limit: principal ? 5 : 20,
    windowMs: 60_000
  }),
  loadService: async () => createOrdinaryOwnerService({
    db: prisma,
    loadSession: getCurrentSession,
    env: process.env
  })
});
