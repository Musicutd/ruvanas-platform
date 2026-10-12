import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivatePreviewAdmin, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { readPromoOnlyAudioSampleConfig } from "@/lib/promo-only-audio-sample.mjs";
import { recoverPromoOnlyAudioSample,
  safePromoOnlyAudioSampleCode } from "@/lib/promo-only-audio-sample-service";
import { sampleRequestBodyIsEmpty } from "@/lib/promo-only-metadata-sample-service";
import { consumeRateLimit } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "cross-origin-resource-policy": "same-origin"
});

function json(body, status) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

export async function POST(request) {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return json({ error: "Private preview is unavailable." }, 503);
  if (request.headers.get("origin") !== policy.previewOrigin) {
    return json({ error: "Request not permitted." }, 403);
  }

  let actorUserId = null;
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
    if (!config.enabled || !config.ready) {
      return json({ error: "Manual audio sample is disabled." }, 409);
    }
    const actorHash = crypto.createHash("sha256").update(actorUserId).digest("hex");
    const limit = await consumeRateLimit({ key: `promo-only-audio-queue-recovery:${actorHash}`,
      limit: 2, windowMs: 60 * 60_000 });
    if (!limit.allowed) return json({ error: "Recovery attempt limit reached." }, 429);

    const result = await recoverPromoOnlyAudioSample(prisma, { actorUserId, config });
    securityLog("info", "PROMOONLY_AUDIO_SAMPLE_RECOVERY_RESULT", request,
      { actorUserId, imported: result.imported,
        reconciliationRequired: result.reconciliationRequired,
        phase: result.phase === "ACK" ? "ACK" : null,
        supplierRequestCount: Number.isInteger(result.supplierRequestCount) &&
          result.supplierRequestCount >= 4 && result.supplierRequestCount <= 5
          ? result.supplierRequestCount : null });
    return json({ result }, 200);
  } catch (error) {
    const code = safePromoOnlyAudioSampleCode(error);
    const phase = ["AUTH", "QUEUE", "SERVERS", "MEDIA", "ACK"].includes(error?.phase)
      ? error.phase : null;
    const supplierRequestCount = Number.isInteger(error?.supplierRequestCount) &&
      error.supplierRequestCount >= 0 && error.supplierRequestCount <= 5
      ? error.supplierRequestCount : null;
    securityLog("error", "PROMOONLY_AUDIO_SAMPLE_RECOVERY_BLOCKED", request,
      { actorUserId, code, phase, supplierRequestCount });
    return json({ error: "The private queued audio recovery did not complete safely.", code },
      code === "PROMOONLY_AUDIO_SAMPLE_RECOVERY_NOT_ALLOWED" ||
      code === "PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE" ? 409 : 502);
  }
}
