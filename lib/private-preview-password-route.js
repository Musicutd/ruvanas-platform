import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { authenticatePreviewPassword, PrivatePreviewAccountError } from "./private-preview-accounts.mjs";
import { readPrivatePreviewPolicy, privatePreviewDashboardRoute } from "./private-preview-policy.mjs";
import { PREVIEW_RESPONSE_HEADERS, readPrivatePreviewBody } from "./private-preview-request.mjs";
import { consumeRateLimit, createRateLimitKey } from "./rate-limit";
import { securityLog } from "./security-log";

export async function previewPasswordLogin(request) {
  const policy = readPrivatePreviewPolicy();
  const form = /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get("content-type") || "");
  const json = (body, status) => Response.json(body, { status, headers: PREVIEW_RESPONSE_HEADERS });
  const fail = (reason, status) => form ? new Response(null, { status: 303,
    headers: { ...PREVIEW_RESPONSE_HEADERS, location: `/preview-login?error=${reason}` } }) :
    json({ error: reason === "rate-limited" ? "Too many attempts. Please wait and try again." :
      reason === "unavailable" ? "Private preview is unavailable." : "Incorrect email address or password." }, status);
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return fail("unavailable", 503);
  if (request.headers.get("origin") !== policy.previewOrigin) return json({ error: "Request not permitted." }, 403);
  try {
    const limit = await consumeRateLimit({ key: createRateLimitKey("preview-password", request), limit: 10, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return fail("rate-limited", 429);
    let body;
    try { body = await readPrivatePreviewBody(request, ["email", "password"], { form: true }); }
    catch { return fail("password-invalid", 401); }
    const result = await authenticatePreviewPassword(prisma, { policy, email: body.email, password: body.password });
    const recommendedDashboardRoute = privatePreviewDashboardRoute(result.user, policy);
    if (!recommendedDashboardRoute) return fail("password-invalid", 401);
    await setSessionCookie(result.rawSessionToken, result.expiresAt);
    securityLog("info", "PRIVATE_PREVIEW_PASSWORD_LOGIN_SUCCEEDED", request);
    return form ? new Response(null, { status: 303, headers: { ...PREVIEW_RESPONSE_HEADERS, location: recommendedDashboardRoute } }) :
      json({ success: true, recommendedDashboardRoute }, 200);
  } catch (caught) {
    if (caught instanceof PrivatePreviewAccountError && caught.status === 401) return fail("password-invalid", 401);
    securityLog("warn", "PRIVATE_PREVIEW_PASSWORD_LOGIN_UNAVAILABLE", request);
    return fail("unavailable", 503);
  }
}
