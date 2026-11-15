import { readPilotAdminPolicy, pilotAdminSchemas } from "./pilot-admin-contracts.mjs";
import { safePilotAdminResult } from "./pilot-admin-dtos.mjs";
import { rewardsMutationOriginAllowed } from "./offer-http.mjs";
import { rewardsDenied } from "./errors.mjs";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (body, status = body.ok ? 200 : body.status || 503, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
const denied = value => rewardsDenied(value?.ok === false ? value.code : "UNAVAILABLE");
const OPERATIONS = ["organisations", "overview", "readiness", "prepare", "publishShop", "approveOffer", "invite", "reissue", "revoke"];
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
export function createPilotAdminHttp({ env, authorize, rateLimit, loadService }) {
  async function run(request, operation) {
    try {
      if (!readPilotAdminPolicy(env).enabled) return reply(rewardsDenied("FEATURE_DISABLED"));
      if (!OPERATIONS.includes(operation)) return reply(rewardsDenied("INVALID_REQUEST"));
      const read = operation === "overview" || operation === "organisations" || operation === "readiness", method = read ? "GET" : "POST";
      if (request.method !== method) return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: method });
      const query = new URL(request.url).searchParams;
      if (request.headers.get("sec-fetch-site") === "cross-site") return reply(rewardsDenied("FORBIDDEN"));
      if (!read && (query.size || !rewardsMutationOriginAllowed(request, env))) return reply(rewardsDenied(query.size ? "INVALID_REQUEST" : "FORBIDDEN"));
      const ip = await rateLimit({ request, operation }); if (!ip.allowed) return throttled(ip);
      if (read && [...query.keys()].some(key => query.getAll(key).length !== 1)) return reply(rewardsDenied("INVALID_REQUEST"));
      const parsed = pilotAdminSchemas[operation].safeParse(read ? Object.fromEntries(query) : await boundedJson(request));
      if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST"));
      const input = parsed.data, access = await authorize(input.organisationId);
      if (!access?.ok) return reply(denied(access));
      const limit = await rateLimit({ request, operation, principal: `admin:${access.userId}` }); if (!limit.allowed) return throttled(limit);
      const service = await loadService();
      const result = await service[operation](input);
      if (!result?.ok) return reply(denied(result));
      return reply(safePilotAdminResult(operation, result) || rewardsDenied("UNAVAILABLE"));
    } catch { return reply(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({ run });
}
