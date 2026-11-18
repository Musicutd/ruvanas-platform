import { readShopperAuthPolicy, acceptShopperInvitationSchema, shopperLoginSchema } from "./shopper-auth-contracts.mjs";
import { rewardsMutationOriginAllowed } from "./offer-http.mjs";
import { SHOPPER_COOKIE } from "./shopper-access.mjs";
import { rewardsDenied } from "./errors.mjs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const reply = (body, status = body.ok ? 200 : body.status || 503, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
const cookie = (env, token, expiresAt) => `${SHOPPER_COOKIE}=${token || ""}; Path=/; HttpOnly; SameSite=Lax; ${token ? `Expires=${expiresAt.toUTCString()}` : "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"}${env.NODE_ENV === "production" ? "; Secure" : ""}`;

async function bodyJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return null;
  const size = request.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > 8192)) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  let length = 0; const chunks = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 8192) { await reader.cancel(); return null; } chunks.push(value); }
    const bytes = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; } finally { reader.releaseLock(); }
}

export function createShopperAuthHttp({ env, rateLimit, loadService, getToken, clock = () => new Date() }) {
  async function execute(request, operation) {
    try {
      const enabled = readShopperAuthPolicy(env).enabled;
      if (!enabled && operation !== "logout") return reply(rewardsDenied("FEATURE_DISABLED"));
      if (request.method !== "POST") return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: "POST" });
      if (!rewardsMutationOriginAllowed(request, env)) return reply(rewardsDenied("FORBIDDEN"));
      if (new URL(request.url).search) return reply(rewardsDenied("INVALID_REQUEST"));
      if (!enabled) return reply({ ok: true, next: "/rewards/sign-in" }, 200, { "Set-Cookie": cookie(env) });
      const limit = await rateLimit({ request, operation });
      if (!limit.allowed) return reply({ ok: false, code: "RATE_LIMITED", error: "Too many attempts. Please try again later." }, 429, { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterSeconds || 900))) });
      const body = await bodyJson(request);
      let input;
      if (operation === "logout") {
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return reply(rewardsDenied("INVALID_REQUEST"));
        input = { token: await getToken() };
      } else {
        const parsed = (operation === "invitation" ? acceptShopperInvitationSchema : shopperLoginSchema).safeParse(body);
        if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST"));
        input = parsed.data;
        const identityLimit = await rateLimit({ request, operation, identity: operation === "invitation" ? input.token : input.email });
        if (!identityLimit.allowed) return reply({ ok: false, code: "RATE_LIMITED", error: "Too many attempts. Please try again later." }, 429, { "Retry-After": String(Math.max(1, Math.ceil(identityLimit.retryAfterSeconds || 900))) });
      }
      const service = await loadService();
      const result = await service[operation === "invitation" ? "acceptInvite" : operation](input);
      if (!result.ok) return reply({ ok: false, code: result.code, error: result.error }, result.status || 503);
      if (operation === "logout") return reply({ ok: true, next: "/rewards/sign-in" }, 200, { "Set-Cookie": cookie(env) });
      const now = clock();
      if (!/^[a-f0-9]{64}$/.test(result.rawSessionToken || "") || !(result.expiresAt instanceof Date) ||
        !Number.isFinite(result.expiresAt.getTime()) || result.expiresAt <= now || result.expiresAt - now > 86401_000) return reply(rewardsDenied("UNAVAILABLE"));
      return reply({ ok: true, next: "/rewards" }, 200, { "Set-Cookie": cookie(env, result.rawSessionToken, result.expiresAt) });
    } catch { return reply(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({ login: request => execute(request, "login"), invitation: request => execute(request, "invitation"), logout: request => execute(request, "logout") });
}
