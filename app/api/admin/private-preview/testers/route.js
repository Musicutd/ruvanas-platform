import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPreviewTester, updatePreviewTester, PrivatePreviewAccountError } from "@/lib/private-preview-accounts.mjs";
import { isPrivatePreviewAdminSession, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { PREVIEW_RESPONSE_HEADERS, readPrivatePreviewBody } from "@/lib/private-preview-request.mjs";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
const json = (body, status) => Response.json(body, { status, headers: PREVIEW_RESPONSE_HEADERS });
async function handle(request, update) {
  const policy = readPrivatePreviewPolicy();
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return json({ error: "Private preview unavailable." }, 503);
  if (request.headers.get("origin") !== policy.previewOrigin) return json({ error: "Request not permitted." }, 403);
  try {
    const session = await getCurrentSession();
    if (!isPrivatePreviewAdminSession(session, policy)) return json({ error: "Access denied." }, 403);
    const limit = await consumeRateLimit({ key: createRateLimitKey("preview-tester-management", request, session.userId), limit: 30, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) return json({ error: "Too many changes. Please wait and try again." }, 429);
    let body;
    try { body = await readPrivatePreviewBody(request, update ? ["userId", "pillars", "enabled", "password"] : ["email", "name", "password", "pillars"]); }
    catch { return json({ error: "Invalid request." }, 400); }
    const options = { ...body, actorUserId: session.userId, policy };
    const tester = await (update ? updatePreviewTester(prisma, options) : createPreviewTester(prisma, options));
    securityLog("info", update ? "PRIVATE_PREVIEW_TESTER_UPDATED" : "PRIVATE_PREVIEW_TESTER_CREATED", request, { actorUserId: session.userId });
    return json({ success: true, tester }, update ? 200 : 201);
  } catch (caught) {
    if (caught instanceof PrivatePreviewAccountError && caught.status < 500) return json({ error:
      caught.code === "INVALID_PASSWORD" ? "Passwords need at least 12 characters and at most 72 UTF-8 bytes." :
        caught.code === "TESTER_LIMIT" ? "The preview is limited to 20 tester accounts." :
          "Unable to save this tester. Use a new email and select one or more pillars; existing accounts cannot be overwritten." }, caught.status);
    securityLog("error", "PRIVATE_PREVIEW_TESTER_MANAGEMENT_UNAVAILABLE", request);
    return json({ error: "Tester management is temporarily unavailable." }, 503);
  }
}
export const POST = (request) => handle(request, false);
export const PATCH = (request) => handle(request, true);
