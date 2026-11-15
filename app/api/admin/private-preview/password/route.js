import { getCurrentSession, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { establishPreviewOwnerPassword, PrivatePreviewAccountError } from "@/lib/private-preview-accounts.mjs";
import { isPrivatePreviewAdminSession, isPrivatePreviewOwnerBootstrapSession, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { PREVIEW_RESPONSE_HEADERS, readPrivatePreviewBody } from "@/lib/private-preview-request.mjs";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
const json = (body, status) => Response.json(body, { status, headers: PREVIEW_RESPONSE_HEADERS });
export async function POST(request) {
  const policy = readPrivatePreviewPolicy();
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return json({ error: "Private preview unavailable." }, 503);
  if (request.headers.get("origin") !== policy.previewOrigin) return json({ error: "Request not permitted." }, 403);
  try {
    const session = await getCurrentSession();
    if (!isPrivatePreviewAdminSession(session, policy) && !isPrivatePreviewOwnerBootstrapSession(session, policy)) return json({ error: "Access denied." }, 403);
    const limit = await consumeRateLimit({ key: createRateLimitKey("preview-owner-password", request, session.userId), limit: 5, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) return json({ error: "Too many attempts. Please wait and try again." }, 429);
    let body;
    try { body = await readPrivatePreviewBody(request, ["password", "currentPassword"]); }
    catch { return json({ error: "Invalid request." }, 400); }
    const result = await establishPreviewOwnerPassword(prisma, { actorUserId: session.userId, sessionId: session.id,
      policy, password: body.password, currentPassword: body.currentPassword });
    await setSessionCookie(result.rawSessionToken, result.expiresAt);
    securityLog("info", "PRIVATE_PREVIEW_OWNER_PASSWORD_SET", request, { actorUserId: session.userId });
    return json({ success: true }, 200);
  } catch (caught) {
    if (caught instanceof PrivatePreviewAccountError && caught.status < 500) return json({ error:
      caught.code === "INVALID_PASSWORD" ? "Use at least 12 characters and no more than 72 UTF-8 bytes." :
        "Password could not be changed. Check your current password or sign in again." }, caught.status);
    securityLog("error", "PRIVATE_PREVIEW_OWNER_PASSWORD_UNAVAILABLE", request);
    return json({ error: "Password setup is temporarily unavailable." }, 503);
  }
}
