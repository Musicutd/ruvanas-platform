import { readRewardsFeaturePolicy } from "./feature-policy.mjs";
import { rewardsDenied } from "./errors.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { createOfferSchema, updateOfferSchema, offerTransitionSchema, offerListSchema } from "./offer-contracts.mjs";

const MAX_BYTES = 128 * 1024;
const headers = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" });
const response = (body, status = body.ok ? 200 : body.status || 500, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });

export function rewardsMutationOriginAllowed(request, env = {}) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site") return false;
    const origin = request.headers.get("origin");
    if (!origin || origin === "null") return false;
    const configured = env.RUVANAS_PUBLIC_URL;
    if (configured) {
      const url = new URL(configured);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return false;
      if (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol === "http:")) return false;
      return origin === url.origin;
    }
    // Development-only fallback; production never trusts Host/Forwarded headers
    // or an absent canonical origin to authorise a browser mutation.
    const url = new URL(request.url);
    return env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && origin === url.origin;
  } catch { return false; }
}

async function boundedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; }
  finally { reader.releaseLock(); }
}

/** HTTP policy is dependency-injected for behavioural tests; production supplies
 * only server-owned adapters. None is called while Rewards is disabled. */
export function createOfferHttpHandlers({ env, authorize, rateLimit, loadService }) {
  async function execute(request, operation, id, action) {
    try {
      if (!readRewardsFeaturePolicy(env).enabled) return response(rewardsDenied("FEATURE_DISABLED"));
      const expectedMethod = operation === "list" ? "GET" : operation === "update" ? "PATCH" : "POST";
      if (request.method !== expectedMethod) return response({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405);
      if (operation !== "list" && !rewardsMutationOriginAllowed(request, env)) return response(rewardsDenied("FORBIDDEN"));
      if (id !== undefined && !rewardIdSchema.safeParse(id).success) return response(rewardsDenied("INVALID_REQUEST"));
      if (operation === "transition" && !["PUBLISH", "PAUSE", "RESUME", "CANCEL"].includes(action)) return response(rewardsDenied("INVALID_REQUEST"));
      let input;
      if (operation === "list") {
        const params = new URL(request.url).searchParams;
        if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return response(rewardsDenied("INVALID_REQUEST"));
        const raw = Object.fromEntries(params);
        if (raw.page !== undefined) {
          if (!/^[1-9]\d*$/.test(raw.page)) return response(rewardsDenied("INVALID_REQUEST"));
          raw.page = Number(raw.page);
        }
        const parsed = offerListSchema.safeParse(raw);
        if (!parsed.success) return response(rewardsDenied("INVALID_REQUEST"));
        input = parsed.data;
      } else {
        const schema = operation === "create" ? createOfferSchema : operation === "update" ? updateOfferSchema : offerTransitionSchema;
        const parsed = schema.safeParse(await boundedJson(request));
        if (!parsed.success) return response(rewardsDenied("INVALID_REQUEST"));
        input = parsed.data;
      }
      const permission = await authorize(operation === "list" ? "READ" : operation === "transition" ? "PUBLISH_OFFERS" : "MANAGE_OFFERS");
      if (!permission.ok) return response(permission);
      const limit = await rateLimit({ request, permission, mutation: operation !== "list" });
      if (!limit.allowed) return response({ ok: false, code: "RATE_LIMITED", error: "Please wait a moment before trying again." }, 429, { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterSeconds || 60))) });
      // Both the service and its transaction independently recheck authority.
      const service = await loadService();
      const result = operation === "list" ? await service.list(input)
        : operation === "create" ? await service.create(input)
        : operation === "update" ? await service.update(id, input)
        : await service.transition(id, action, input);
      return response(result, result.ok && operation === "create" ? 201 : undefined);
    } catch { return response(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({
    list: request => execute(request, "list"), create: request => execute(request, "create"),
    update: (request, id) => execute(request, "update", id),
    transition: (request, id, action) => execute(request, "transition", id, action)
  });
}
