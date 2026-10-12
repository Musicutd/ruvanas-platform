import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivatePreviewAdmin, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { readPromoOnlyAudioSampleConfig } from "@/lib/promo-only-audio-sample.mjs";
import { checkLockedPromoOnlyAudioSampleTransport,
  safePromoOnlyAudioSampleCode } from "@/lib/promo-only-audio-sample-service";
import { sampleRequestBodyIsEmpty } from "@/lib/promo-only-metadata-sample-service";
import { consumeRateLimit } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOSTED_SERVICE_ID = "srv-db5l9d7lk1mc73ad8v7g";
const HOSTED_PREVIEW_ORIGIN = "https://ruvanas-private-preview-20261011.onrender.com";
const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "cross-origin-resource-policy": "same-origin"
});

function json(body, status) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

export async function GET(request) {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return json({ error: "Private preview is unavailable." }, 503);
  const origin = request.headers.get("origin");
  if (origin && origin !== policy.previewOrigin) {
    return json({ error: "Request not permitted." }, 403);
  }

  let actorUserId = null;
  let trustedHostedContext = false;
  try {
    const session = await getCurrentSession();
    if (session?.authMethod !== "PREVIEW_CODE" || !isPrivatePreviewAdmin(session.user, policy)) {
      return json({ error: "Access denied." }, 403);
    }
    actorUserId = session.userId;
    if (new URL(request.url).search || !(await sampleRequestBodyIsEmpty(request))) {
      return json({ error: "This action accepts no input." }, 400);
    }
    const config = readPromoOnlyAudioSampleConfig(process.env);
    if (!config.enabled || !config.ready ||
        process.env.RUVANAS_ENVIRONMENT !== "PRIVATE_PREVIEW" ||
        process.env.RENDER_SERVICE_ID !== HOSTED_SERVICE_ID ||
        policy.previewOrigin !== HOSTED_PREVIEW_ORIGIN) {
      return json({ error: "Hosted private transport check is disabled." }, 409);
    }
    trustedHostedContext = true;
    const actorHash = crypto.createHash("sha256").update(actorUserId).digest("hex");
    const limit = await consumeRateLimit({ key: `promo-only-audio-transport-check:${actorHash}`,
      limit: 1, windowMs: 60 * 60_000 });
    if (!limit.allowed) return json({ error: "Transport check rate limit reached." }, 429);

    const result = await checkLockedPromoOnlyAudioSampleTransport(prisma,
      { actorUserId, config });
    securityLog("info", "PROMOONLY_AUDIO_SAMPLE_TRANSPORT_CHECK", request,
      { actorUserId, context: "HOSTED_RENDER", reachable: result.reachable,
        causeCode: result.causeCode, httpStatus: result.httpStatus,
        apiRequestCount: result.apiRequestCount, headRequestCount: result.headRequestCount });
    return json({ result: { context: "HOSTED_RENDER", ready: true,
      reachable: result.reachable, causeCode: result.causeCode,
      httpStatus: result.httpStatus, apiRequestCount: result.apiRequestCount,
      headRequestCount: result.headRequestCount } }, 200);
  } catch (error) {
    const code = safePromoOnlyAudioSampleCode(error);
    const apiRequestCount = Number.isInteger(error?.apiRequestCount) &&
      error.apiRequestCount >= 0 && error.apiRequestCount <= 2
      ? error.apiRequestCount : null;
    const headRequestCount = Number.isInteger(error?.headRequestCount) &&
      error.headRequestCount >= 0 && error.headRequestCount <= 1
      ? error.headRequestCount : null;
    securityLog("error", "PROMOONLY_AUDIO_SAMPLE_TRANSPORT_CHECK_BLOCKED", request,
      { actorUserId, context: trustedHostedContext ? "HOSTED_RENDER" : "UNVERIFIED",
        code, apiRequestCount, headRequestCount });
    return json({ error: "The private transport check did not complete safely.", code },
      code === "PROMOONLY_AUDIO_SAMPLE_TRANSPORT_NOT_ALLOWED" ||
      code === "PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE" ? 409 : 502);
  }
}
