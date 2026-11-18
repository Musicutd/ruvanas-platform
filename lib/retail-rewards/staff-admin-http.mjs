import { readStaffAdminPolicy, staffAdminSchemas } from "./staff-admin-contracts.mjs";
import { safeStaffAdminResult } from "./staff-admin-dtos.mjs";
import { rewardsMutationOriginAllowed } from "./offer-http.mjs";
import { rewardsDenied } from "./errors.mjs";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (body, status = body.ok ? 200 : body.status || 503, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
const denied = value => rewardsDenied(value?.ok === false ? value.code : "UNAVAILABLE");
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
export function createStaffAdminHttp({ env, authorize, rateLimit, loadService }) {
  async function run(request, operation) {
    try {
      if (!readStaffAdminPolicy(env).enabled) return reply(rewardsDenied("FEATURE_DISABLED"));
      if (!["overview", "save", "revoke"].includes(operation)) return reply(rewardsDenied("INVALID_REQUEST"));
      const read = operation === "overview", method = read ? "GET" : "POST";
      if (request.method !== method) return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: method });
      if (new URL(request.url).searchParams.size) return reply(rewardsDenied("INVALID_REQUEST"));
      if (request.headers.get("sec-fetch-site") === "cross-site" || (!read && !rewardsMutationOriginAllowed(request, env))) return reply(rewardsDenied("FORBIDDEN"));
      const ip = await rateLimit({ request, operation }); if (!ip.allowed) return throttled(ip);
      const parsed = staffAdminSchemas[operation].safeParse(read ? {} : await boundedJson(request));
      if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST"));
      const access = await authorize(); if (!access?.ok) return reply(denied(access));
      const limit = await rateLimit({ request, operation, principal: `${access.organisationId}:${access.userId}` });
      if (!limit.allowed) return throttled(limit);
      const result = await (await loadService())[operation](parsed.data);
      if (!result?.ok) return reply(denied(result));
      return reply(safeStaffAdminResult(operation, result) || rewardsDenied("UNAVAILABLE"));
    } catch { return reply(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({ run });
}
