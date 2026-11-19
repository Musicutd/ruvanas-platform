import { createHmac } from "node:crypto";
import { readPilotPreviewPolicy } from "./pilot-preview-policy.mjs";
import { pilotLoginSchema } from "./pilot-login-service.mjs";
import { rewardsMutationOriginAllowed } from "./offer-http.mjs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const messages = { AUTH_FAILED: "Unable to sign in with these pilot details.", FEATURE_DISABLED: "Pilot sign-in is unavailable.",
  INVALID_REQUEST: "Check the sign-in details.", UNAVAILABLE: "Pilot sign-in is temporarily unavailable.", FORBIDDEN: "This sign-in request is not allowed.", RATE_LIMITED: "Too many sign-in attempts. Please try again later." };
const statuses = { AUTH_FAILED: 401, FEATURE_DISABLED: 404, INVALID_REQUEST: 400, UNAVAILABLE: 503, FORBIDDEN: 403, RATE_LIMITED: 429 };
const fail = (code, extra = {}) => Response.json({ ok: false, code, error: messages[code] }, { status: statuses[code], headers: { ...headers, ...extra } });
async function bodyJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return null;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192)) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  try {
    let size = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 8192) { await reader.cancel(); return null; } chunks.push(value); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; } finally { reader.releaseLock(); }
}
export function createPilotLoginHttp({ env, rateLimit, loadService, clock = () => new Date() }) {
  return async function login(request) {
    try {
      if (!readPilotPreviewPolicy(env).enabled) return fail("FEATURE_DISABLED");
      if (request.method !== "POST") return Response.json({ ok: false, code: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { ...headers, Allow: "POST" } });
      if (!rewardsMutationOriginAllowed(request, env) || request.headers.has("next-action")) return fail("FORBIDDEN");
      if (new URL(request.url).search) return fail("INVALID_REQUEST");
      const ip = await rateLimit({ request }); if (!ip.allowed) return fail("RATE_LIMITED", { "Retry-After": String(Math.max(1, Math.ceil(ip.retryAfterSeconds || 900))) });
      const input = pilotLoginSchema.safeParse(await bodyJson(request)); if (!input.success) return fail("INVALID_REQUEST");
      if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) return fail("UNAVAILABLE");
      const identity = createHmac("sha256", env.SESSION_SECRET).update(`rewards-pilot-login:${input.data.email}`).digest("hex");
      const account = await rateLimit({ request, identity }); if (!account.allowed) return fail("RATE_LIMITED", { "Retry-After": String(Math.max(1, Math.ceil(account.retryAfterSeconds || 900))) });
      const result = await (await loadService()).login(input.data);
      if (result?.ok !== true) return fail(Object.hasOwn(statuses, result?.code) ? result.code : "UNAVAILABLE");
      const now = clock();
      if (!/^[a-f0-9]{64}$/.test(result.rawSessionToken || "") || !(result.expiresAt instanceof Date) ||
          !Number.isFinite(result.expiresAt.getTime()) || !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
          result.expiresAt <= now || result.expiresAt - now > 3_601_000 ||
          !["/admin/retail-rewards/pilot", "/dashboard/retail/rewards", "/dashboard/retail/rewards/redeem"].includes(result.landing)) return fail("UNAVAILABLE");
      return Response.json({ ok: true, landing: result.landing }, { headers: { ...headers,
        "Set-Cookie": `ruvanas_session=${result.rawSessionToken}; Path=/; HttpOnly; SameSite=Lax; Expires=${result.expiresAt.toUTCString()}${env.NODE_ENV === "production" ? "; Secure" : ""}` } });
    } catch { return fail("UNAVAILABLE"); }
  };
}
