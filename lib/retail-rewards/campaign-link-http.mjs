import { readCampaignLinkPolicy, campaignLinkReviewSchema, campaignLinkSaveSchema } from "./campaign-link-contracts.mjs";
import { safeCampaignLinkResult } from "./campaign-link-dtos.mjs";
import { rewardsMutationOriginAllowed } from "./offer-http.mjs";
import { rewardsDenied } from "./errors.mjs";

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

export function createCampaignLinkHttp({ env, authorizeStaff, rateLimit, loadService }) {
  async function run(request, operation) {
    try {
      if (!readCampaignLinkPolicy(env).enabled) return reply(rewardsDenied("FEATURE_DISABLED"));
      if (request.method !== "POST") return reply({ ok: false, code: "METHOD_NOT_ALLOWED", error: "This method is not available." }, 405, { Allow: "POST" });
      if (new URL(request.url).searchParams.size) return reply(rewardsDenied("INVALID_REQUEST"));
      if (!rewardsMutationOriginAllowed(request, env)) return reply(rewardsDenied("FORBIDDEN"));
      const ip = await rateLimit({ request, operation }); if (!ip.allowed) return throttled(ip);
      const parsed = (operation === "review" ? campaignLinkReviewSchema : campaignLinkSaveSchema).safeParse(await boundedJson(request));
      if (!parsed.success) return reply(rewardsDenied("INVALID_REQUEST"));
      const access = await authorizeStaff(); if (!access?.ok) return reply(failure(access));
      const principal = `staff:${access.organisationId}:${access.userId}`;
      const limit = await rateLimit({ request, operation, principal }); if (!limit.allowed) return throttled(limit);
      const service = await loadService();
      const result = operation === "review" ? await service.campaignLinks(parsed.data) : await service.saveCampaignLink(parsed.data);
      if (!result?.ok) return reply(failure(result));
      return reply(safeCampaignLinkResult(operation, result) || rewardsDenied("UNAVAILABLE"));
    } catch { return reply(rewardsDenied("UNAVAILABLE")); }
  }
  return Object.freeze({ review: request => run(request, "review"), save: request => run(request, "save") });
}
