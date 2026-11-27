import { accountRecoveryMode } from "./account-recovery-service.mjs";
import { hashAccountRecoveryToken, normalizeRecoveryEmail, validateRecoveryPassword } from "./account-recovery.mjs";
import { rewardsMutationOriginAllowed } from "./retail-rewards/offer-http.mjs";

const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const messages = { FEATURE_DISABLED: "Password recovery is currently closed.",
  DELIVERY_UNAVAILABLE: "Password recovery email is not configured. Please contact the Super Admin.",
  INVALID_REQUEST: "Check the recovery details.", INVALID_LINK: "This recovery link is invalid or has expired. Request a new link.",
  FORBIDDEN: "This request did not originate from an approved Ruvanas site.",
  UNAVAILABLE: "Password recovery is unavailable right now. Please try again later.",
  RATE_LIMITED: "Too many recovery attempts. Please wait before trying again." };
const statuses = { FEATURE_DISABLED: 404, DELIVERY_UNAVAILABLE: 503, INVALID_REQUEST: 400, INVALID_LINK: 410,
  FORBIDDEN: 403, UNAVAILABLE: 503, RATE_LIMITED: 429 };
const fail = (code, error, extra = {}) => Response.json({ ok: false, code, error: error || messages[code] },
  { status: statuses[code], headers: { ...headers, ...extra } });
async function boundedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 8192)) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  try {
    let length = 0; const chunks = [];
    for (;;) { const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 8192) { await reader.cancel(); return null; } chunks.push(value); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; } finally { reader.releaseLock(); }
}

export function createAccountRecoveryHttp({ env, rateLimit, loadService, clock = () => new Date(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), requestId = () => undefined }) {
  async function execute(request, operation) {
    const started = Date.now();
    try {
      if (accountRecoveryMode(env, clock()) === "DISABLED") return fail("FEATURE_DISABLED");
      if (request.method !== "POST") return Response.json({ ok: false, code: "METHOD_NOT_ALLOWED" },
        { status: 405, headers: { ...headers, Allow: "POST" } });
      if (!rewardsMutationOriginAllowed(request, env) || request.headers.has("next-action")) return fail("FORBIDDEN");
      if (new URL(request.url).search) return fail("INVALID_REQUEST");
      const ip = await rateLimit({ request, operation });
      if (!ip.allowed) return fail("RATE_LIMITED", null, { "Retry-After": String(Math.max(1, Math.ceil(ip.retryAfterSeconds || 900))) });
      const body = await boundedJson(request);
      const keys = operation === "request" ? ["email"] : ["token", "password", "confirmation"];
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== keys.length || keys.some(key => typeof body[key] !== "string")) return fail("INVALID_REQUEST");
      let subject;
      if (operation === "request") {
        try { body.email = normalizeRecoveryEmail(body.email); subject = body.email; } catch { return fail("INVALID_REQUEST", "Enter a valid email address."); }
      } else {
        const password = validateRecoveryPassword(body);
        if (!password.ok) return fail("INVALID_REQUEST", password.error);
        try { subject = hashAccountRecoveryToken(body.token); } catch { return fail("INVALID_LINK"); }
      }
      const account = await rateLimit({ request, operation, subject });
      if (!account.allowed) return fail("RATE_LIMITED", null, { "Retry-After": String(Math.max(1, Math.ceil(account.retryAfterSeconds || 900))) });
      const result = await (await loadService())[operation](body, { requestUrl: request.url, requestId: requestId(request) });
      if (result?.ok !== true) {
        const code = Object.hasOwn(statuses, result?.code) ? result.code : "UNAVAILABLE";
        return fail(code, code === "INVALID_REQUEST" ? result.error : undefined);
      }
      // Only the service's intentionally public fields leave this boundary.
      return Response.json({ ok: true, message: result.message,
        ...(operation === "reset" ? { destination: result.destination } : {}) }, { headers });
    } catch { return fail("UNAVAILABLE"); }
    finally {
      // Uniform response bodies disclose no account or provider result or token.
      // This minimum delay does not mask slower database or email-provider work;
      // synchronous delivery can still create a timing difference.
      if (operation === "request") await wait(Math.max(0, 700 - (Date.now() - started)));
    }
  }
  return { request: request => execute(request, "request"), reset: request => execute(request, "reset") };
}
