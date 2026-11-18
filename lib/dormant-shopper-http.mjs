import { z } from "zod";
import { rewardsMutationOriginAllowed } from "./retail-rewards/offer-http.mjs";
import { dormantShopperInputSchema } from "./dormant-shopper-provisioning.mjs";

const MAX_BYTES = 8192;
const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
});
const ERRORS = Object.freeze({
  AUTH_REQUIRED: [401, "Sign in with your Ruvanas Super Admin account."],
  FORBIDDEN: [403, "This request requires an authenticated Ruvanas Super Admin session."],
  INVALID_REQUEST: [400, "Provide the test workspace and shopper details, and confirm disabled setup."],
  EMAIL_EXISTS: [409, "That email address already belongs to an account. Existing accounts cannot be changed here."],
  ORGANISATION_UNAVAILABLE: [409, "The workspace is unavailable."],

  CONFLICT: [409, "That shopper setup already exists. Check saved setups before trying again."],
  UNAVAILABLE: [503, "The disabled shopper could not be prepared. Please try again later."]
});
const id = z.string().min(1).max(191).regex(/^[a-zA-Z0-9_-]+$/);
const resultSchema = z.object({
  ok: z.literal(true),
  organisation: z.object({ id, name: z.string().min(1).max(160) }).strict(),
  shopper: z.object({ id, email: z.string().max(254).email(), displayName: z.string().min(1).max(80), status: z.literal("DISABLED") }).strict()
}).strict();
const reply = (body, status, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
function denied(code) {
  const key = Object.hasOwn(ERRORS, code) ? code : "UNAVAILABLE";
  const [status, error] = ERRORS[key];
  return reply({ ok: false, code: key, error }, status);
}
function throttled(limit) {
  const requested = Number(limit?.retryAfterSeconds);
  const seconds = Number.isFinite(requested) ? Math.min(3600, Math.max(1, Math.ceil(requested))) : 60;
  return reply({ ok: false, code: "RATE_LIMITED", error: "Too many attempts. Please try again shortly." }, 429,
    { "Retry-After": String(seconds) });
}
async function boundedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  try {
    const chunks = []; let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) { await reader.cancel(); return null; }
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

// Provisioning is a platform-administration operation, independent of Rewards
// activation. Production injects server-only authentication, limits and service.
export function createDormantShopperHttp({ authorize, rateLimit, loadService, env = {} }) {
  async function run(request) {
    try {
      if (request.method !== "POST") return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Use POST to prepare a disabled shopper." }, 405, { Allow: "POST" });
      if (new URL(request.url).searchParams.size) return denied("INVALID_REQUEST");
      if (!rewardsMutationOriginAllowed(request, env)) return denied("FORBIDDEN");
      const operation = "createDormantShopper";
      const ipLimit = await rateLimit({ request, operation });
      if (ipLimit?.allowed !== true) return throttled(ipLimit);
      const access = await authorize();
      if (access?.ok !== true) return denied(access?.code);
      if (!id.safeParse(access.userId).success) return denied("UNAVAILABLE");
      const userLimit = await rateLimit({ request, operation, principal: `admin:${access.userId}` });
      if (userLimit?.allowed !== true) return throttled(userLimit);
      const parsed = dormantShopperInputSchema.safeParse(await boundedJson(request));
      if (!parsed.success) return denied("INVALID_REQUEST");
      const service = await loadService();
      const result = await service.create(parsed.data);
      if (result?.ok !== true) return denied(result?.code);
      const safe = resultSchema.safeParse(result);
      if (!safe.success) return denied("UNAVAILABLE");
      return reply(safe.data, 201);
    } catch { return denied("UNAVAILABLE"); }
  }
  return Object.freeze({ run });
}
