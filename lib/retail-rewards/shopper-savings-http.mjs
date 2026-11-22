import { readShopperFeaturePolicy } from "./shopper-contracts.mjs";
import { rewardsDenied } from "./errors.mjs";
import { safeShopperSavingsSnapshot } from "./shopper-savings-contracts.mjs";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
const response = (value, status = value.ok ? 200 : value.status || 503, extra = {}) => Response.json(value, { status, headers: { ...HEADERS, ...extra } });
const denied = value => response(rewardsDenied(value?.code));
const limited = result => response({ ok: false, code: "RATE_LIMITED", error: "Please wait a moment before trying again." }, 429,
  { "Retry-After": String(Number.isFinite(result.retryAfterSeconds) ? Math.max(1, Math.ceil(result.retryAfterSeconds)) : 60) });

export function createShopperSavingsHttp({ env = {}, authorize, rateLimit, loadService }) {
  return Object.freeze({ async inspect(request) {
    try {
      if (!readShopperFeaturePolicy(env).enabled) return response(rewardsDenied("FEATURE_DISABLED"));
      if (request.method !== "GET") return response({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: "GET" });
      if ([...new URL(request.url).searchParams].length) return response(rewardsDenied("INVALID_REQUEST"));
      const preflight = await rateLimit({ request, access: null }); if (!preflight.allowed) return limited(preflight);
      const access = await authorize(); if (!access?.ok) return denied(access);
      const bound = await rateLimit({ request, access }); if (!bound.allowed) return limited(bound);
      const service = await loadService();
      const value = await service.inspect();
      if (!value?.ok) return denied(value);
      const snapshot = safeShopperSavingsSnapshot(value);
      if (!snapshot) return response(rewardsDenied("UNAVAILABLE"));
      if (!readShopperFeaturePolicy(env).enabled) return response(rewardsDenied("FEATURE_DISABLED"));
      return response(snapshot);
    } catch { return response(rewardsDenied("UNAVAILABLE")); }
  } });
}
