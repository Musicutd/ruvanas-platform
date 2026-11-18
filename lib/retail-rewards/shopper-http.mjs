import { readShopperFeaturePolicy, shopperBrowseSchema, shopperLocationsSchema, publicSlugSchema } from "./shopper-contracts.mjs";
import { rewardsDenied } from "./errors.mjs";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" });
const response = (data, status = data.ok ? 200 : data.status || 503, extra = {}) => Response.json(data, { status, headers: { ...HEADERS, ...extra } });

export function createShopperDiscoveryHttp({ env, authorize, rateLimit, loadService }) {
  async function execute(request, operation, shopSlug, offerSlug) {
    try {
      if (!readShopperFeaturePolicy(env).enabled) return response(rewardsDenied("FEATURE_DISABLED"));
      if (request.method !== "GET") return response({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: "GET" });
      if ((shopSlug !== undefined && !publicSlugSchema.safeParse(shopSlug).success) ||
          (offerSlug !== undefined && !publicSlugSchema.safeParse(offerSlug).success)) return response(rewardsDenied("OFFER_UNAVAILABLE"));
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return response(rewardsDenied("INVALID_REQUEST"));
      const raw = Object.fromEntries(params);
      if (operation === "offer" && Object.keys(raw).length) return response(rewardsDenied("INVALID_REQUEST"));
      if (raw.page !== undefined) {
        if (!/^[1-9]\d*$/.test(raw.page)) return response(rewardsDenied("INVALID_REQUEST"));
        raw.page = Number(raw.page);
      }
      const parsed = (operation === "locations" ? shopperLocationsSchema : shopperBrowseSchema).safeParse(raw);
      if (!parsed.success) return response(rewardsDenied("INVALID_REQUEST"));
      const preflightLimit = await rateLimit({ request, access: null });
      if (!preflightLimit.allowed) return response({ ok: false, code: "RATE_LIMITED", error: "Please wait a moment before trying again." }, 429,
        { "Retry-After": String(Math.max(1, Math.ceil(preflightLimit.retryAfterSeconds || 60))) });
      const access = await authorize();
      if (!access.ok) return response(access);
      const limit = await rateLimit({ request, access });
      if (!limit.allowed) return response({ ok: false, code: "RATE_LIMITED", error: "Please wait a moment before trying again." }, 429,
        { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterSeconds || 60))) });
      const service = await loadService();
      const result = operation === "locations" ? await service.locations(parsed.data)
        : operation === "shops" ? await service.shops(parsed.data)
        : operation === "shop" ? await service.shop(shopSlug, parsed.data)
        : await service.offer(shopSlug, offerSlug);
      return response(result);
    } catch { return response(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({ locations: request => execute(request, "locations"), shops: request => execute(request, "shops"),
    shop: (request, slug) => execute(request, "shop", slug),
    offer: (request, slug, offerSlug) => execute(request, "offer", slug, offerSlug) });
}
