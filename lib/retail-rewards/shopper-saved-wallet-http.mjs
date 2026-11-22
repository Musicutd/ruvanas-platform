import { rewardIdSchema } from "./contracts.mjs";
import { readShopperFeaturePolicy } from "./shopper-contracts.mjs";
import { rewardsMutationOriginAllowed } from "./offer-http.mjs";
import { rewardsDenied } from "./errors.mjs";
import { savedVoucherPairSchema, savedWalletQuerySchema, savedWalletStatusSchema, safeSavedWalletResult } from "./shopper-saved-wallet-contracts.mjs";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
const reply = (value, status = value.ok ? 200 : value.status || 503, extra = {}) => Response.json(value, { status, headers: { ...HEADERS, ...extra } });
async function boundedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 8192)) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  try {
    const chunks = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 8192) { await reader.cancel(); return null; } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; } finally { reader.releaseLock(); }
}
const limited = value => reply({ ok: false, code: "RATE_LIMITED", error: "Please wait a moment before trying again." }, 429,
  { "Retry-After": String(Number.isFinite(value.retryAfterSeconds) ? Math.max(1, Math.ceil(value.retryAfterSeconds)) : 60) });

export function createShopperSavedWalletHttp({ env = {}, authorize, rateLimit, loadService }) {
  async function run(request, operation, id) {
    try {
      if (!readShopperFeaturePolicy(env).enabled) return reply(rewardsDenied("FEATURE_DISABLED"));
      const method = operation === "list" ? "GET" : operation === "remove" ? "DELETE" : "POST";
      if (request.method !== method) return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: method });
      const query = new URL(request.url).searchParams;
      if (operation !== "list" && (query.size || !rewardsMutationOriginAllowed(request, env))) return reply(rewardsDenied(query.size ? "INVALID_REQUEST" : "FORBIDDEN"));
      if (operation === "remove" && !rewardIdSchema.safeParse(id).success) return reply(rewardsDenied("INVALID_REQUEST"));
      const preflight = await rateLimit({ request, operation, access: null }); if (!preflight.allowed) return limited(preflight);
      let input;
      if (operation === "list") {
        if ([...query.keys()].some(key => key !== "page") || query.getAll("page").length > 1 ||
          (query.has("page") && !/^[1-9]\d*$/.test(query.get("page")))) return reply(rewardsDenied("INVALID_REQUEST"));
        const parsed = savedWalletQuerySchema.safeParse(query.has("page") ? { page: Number(query.get("page")) } : {});
        if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST")); input = parsed.data;
      } else if (operation === "remove") {
        if (request.body) { const body = await boundedJson(request);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return reply(rewardsDenied("INVALID_REQUEST")); }
        input = id;
      } else {
        const schema = operation === "save" ? savedVoucherPairSchema : savedWalletStatusSchema;
        const parsed = schema.safeParse(await boundedJson(request));
        if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST")); input = parsed.data;
      }
      const access = await authorize(); if (!access?.ok) return reply(rewardsDenied(access?.code));
      const bound = await rateLimit({ request, operation, access }); if (!bound.allowed) return limited(bound);
      const service = await loadService(), result = await service[operation](input);
      if (!result?.ok) return reply(rewardsDenied(result?.code));
      if (!readShopperFeaturePolicy(env).enabled) return reply(rewardsDenied("FEATURE_DISABLED"));
      return reply(safeSavedWalletResult(operation, result) || rewardsDenied("UNAVAILABLE"));
    } catch { return reply(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({ list: request => run(request, "list"), save: request => run(request, "save"),
    remove: (request, id) => run(request, "remove", id), status: request => run(request, "status") });
}
