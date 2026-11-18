import { rewardIdSchema } from "./contracts.mjs";
import { readCheckoutPolicy, createClaimSchema, walletQuerySchema, staffValidateSchema, staffRedeemSchema } from "./checkout-contracts.mjs";
import { rewardsMutationOriginAllowed } from "./offer-http.mjs";
import { rewardsDenied } from "./errors.mjs";
import { safeCheckoutResult } from "./checkout-dtos.mjs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const reply = (body, status = body.ok ? 200 : body.status || 503, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
async function boundedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return null;
  const size = request.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > 8192)) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  try {
    const chunks = []; let length = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 8192) { await reader.cancel(); return null; } chunks.push(value); }
    const bytes = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; } finally { reader.releaseLock(); }
}
const safeFailure = value => rewardsDenied(value?.ok === false ? value.code : "UNAVAILABLE");

export function createCheckoutHttp({ env, authorizeShopper, authorizeStaff, rateLimit, loadService }) {
  async function run(request, operation, id) {
    try {
      if (!readCheckoutPolicy(env).enabled) return reply(rewardsDenied("FEATURE_DISABLED"));
      const read = ["wallet", "staffLocations"].includes(operation), method = read ? "GET" : "POST";
      if (request.method !== method) return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: method });
      const query = new URL(request.url).searchParams;
      if (!read && (query.size || !rewardsMutationOriginAllowed(request, env))) return reply(rewardsDenied(query.size ? "INVALID_REQUEST" : "FORBIDDEN"));
      const limit = await rateLimit({ request, operation });
      if (!limit.allowed) return reply({ ok: false, code: "RATE_LIMITED", error: "Too many attempts. Please try again shortly." }, 429, { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterSeconds || 60))) });
      let input;
      if (read) {
        if ([...query.keys()].some(key => key !== "page") || query.getAll("page").length > 1 ||
          (query.has("page") && !/^[1-9]\d*$/.test(query.get("page")))) return reply(rewardsDenied("INVALID_REQUEST"));
        const parsed = walletQuerySchema.safeParse(query.has("page") ? { page: Number(query.get("page")) } : {});
        if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST")); input = parsed.data;
      } else {
        const body = await boundedJson(request);
        if (operation === "credential") {
          if (!rewardIdSchema.safeParse(id).success || !body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return reply(rewardsDenied("INVALID_REQUEST"));
          input = id;
        } else {
          const schema = operation === "claim" ? createClaimSchema : operation === "validate" ? staffValidateSchema : staffRedeemSchema;
          const parsed = schema.safeParse(body); if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST")); input = parsed.data;
        }
      }
      const shopper = ["wallet", "claim", "credential"].includes(operation);
      const access = await (shopper ? authorizeShopper() : authorizeStaff(input?.locationId));
      if (!access?.ok) return reply(safeFailure(access));
      const principal = shopper ? `shopper:${access.shopperId}` : `staff:${access.organisationId}:${access.userId}`;
      const principalLimit = await rateLimit({ request, operation, principal });
      if (!principalLimit.allowed) return reply({ ok: false, code: "RATE_LIMITED", error: "Too many attempts. Please try again shortly." }, 429, { "Retry-After": String(Math.max(1, Math.ceil(principalLimit.retryAfterSeconds || 60))) });
      const service = await loadService(); const result = await service[operation](input);
      if (!result?.ok) return reply(safeFailure(result));
      // Validate nested projections too: a mistakenly returned private row or
      // bearer code in another operation must fail closed, not be serialized.
      const projected = safeCheckoutResult(operation, result);
      return reply(projected || rewardsDenied("UNAVAILABLE"));
    } catch { return reply(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({ wallet: request => run(request, "wallet"), claim: request => run(request, "claim"),
    credential: (request, id) => run(request, "credential", id), staffLocations: request => run(request, "staffLocations"),
    validate: request => run(request, "validate"), redeem: request => run(request, "redeem") });
}
