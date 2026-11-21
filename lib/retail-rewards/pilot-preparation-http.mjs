import { rewardIdSchema } from "./contracts.mjs";
import { pilotPreparationInputSchema, safePilotPreparationSnapshot, pilotPreparationDenied } from "./pilot-preparation-contracts.mjs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (body, status = body.ok ? 200 : body.status || 503, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
const denied = code => reply(pilotPreparationDenied(code));
function throttle(limit) {
  const retry = Number(limit?.retryAfterSeconds), seconds = Number.isFinite(retry) ? Math.min(3600, Math.max(1, Math.ceil(retry))) : 60;
  return reply({ ok: false, code: "RATE_LIMITED", error: "Too many attempts. Please try again shortly." }, 429, { "Retry-After": String(seconds) });
}
export function createPilotPreparationHttp({ authorize, rateLimit, loadService }) {
  return Object.freeze({ async run(request) {
    try {
      if (request.method !== "GET") return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Use GET to read preparation." }, 405, { Allow: "GET" });
      if (request.headers.get("sec-fetch-site") === "cross-site") return denied("FORBIDDEN");
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return denied("INVALID_REQUEST");
      const input = pilotPreparationInputSchema.safeParse(Object.fromEntries(query));
      if (!input.success) return denied("INVALID_REQUEST");
      const operation = "pilotPreparation", ip = await rateLimit({ request, operation });
      if (ip?.allowed !== true) return throttle(ip);
      const access = await authorize(); if (access?.ok !== true) return denied(access?.code);
      if (!rewardIdSchema.safeParse(access.userId).success) return denied("UNAVAILABLE");
      const user = await rateLimit({ request, operation, principal: `admin:${access.userId}` });
      if (user?.allowed !== true) return throttle(user);
      const result = await (await loadService()).inspect(input.data);
      if (result?.ok !== true) return denied(result?.code);
      return reply(safePilotPreparationSnapshot(result, input.data.organisationId) || pilotPreparationDenied("UNAVAILABLE"));
    } catch { return denied("UNAVAILABLE"); }
  } });
}
