import { readReversalPolicy, reversalQuerySchema, reversalInspectSchema, reversalRequestSchema } from "./reversal-contracts.mjs";
import { rewardsMutationOriginAllowed } from "./offer-http.mjs";
import { rewardsDenied } from "./errors.mjs";
import { safeReversalResult } from "./reversal-dtos.mjs";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const reply = (body, status = body.ok ? 200 : body.status || 503, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
const failure = value => rewardsDenied(value?.ok === false ? value.code : "UNAVAILABLE");
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
const throttled = limit => reply({ ok: false, code: "RATE_LIMITED", error: "Too many attempts. Please try again shortly." }, 429,
  { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterSeconds || 60))) });
export function createReversalHttp({ env, authorizeStaff, rateLimit, loadService }) {
  async function run(request, operation) {
    try {
      if (!readReversalPolicy(env).enabled) return reply(rewardsDenied("FEATURE_DISABLED"));
      const read = operation === "locations", method = read ? "GET" : "POST";
      if (request.method !== method) return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: method });
      const query = new URL(request.url).searchParams;
      if (!read && (query.size || !rewardsMutationOriginAllowed(request, env))) return reply(rewardsDenied(query.size ? "INVALID_REQUEST" : "FORBIDDEN"));
      const ip = await rateLimit({ request, operation }); if (!ip.allowed) return throttled(ip);
      let input;
      if (read) {
        if ([...query.keys()].some(key => key !== "page") || query.getAll("page").length > 1 ||
          (query.has("page") && !/^[1-9]\d*$/.test(query.get("page")))) return reply(rewardsDenied("INVALID_REQUEST"));
        const parsed = reversalQuerySchema.safeParse(query.has("page") ? { page: Number(query.get("page")) } : {});
        if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST")); input = parsed.data;
      } else {
        const schema = operation === "inspect" ? reversalInspectSchema : reversalRequestSchema;
        const parsed = schema.safeParse(await boundedJson(request)); if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST")); input = parsed.data;
      }
      const access = await authorizeStaff(input.locationId); if (!access?.ok) return reply(failure(access));
      const principal = `staff:${access.organisationId}:${access.userId}`;
      const limit = await rateLimit({ request, operation, principal }); if (!limit.allowed) return throttled(limit);
      const service = await loadService(), result = await service[operation](input);
      if (!result?.ok) return reply(failure(result));
      return reply(safeReversalResult(operation, result) || rewardsDenied("UNAVAILABLE"));
    } catch { return reply(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({ locations: request => run(request, "locations"), inspect: request => run(request, "inspect"), reverse: request => run(request, "reverse") });
}
