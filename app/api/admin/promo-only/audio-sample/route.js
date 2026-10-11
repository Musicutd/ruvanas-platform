import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivatePreviewAdmin, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { readPromoOnlyAudioSampleConfig } from "@/lib/promo-only-audio-sample.mjs";
import { importPromoOnlyAudioSample, safePromoOnlyAudioSampleCode } from "@/lib/promo-only-audio-sample-service";
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
  if (request.headers.get("origin") !== policy.previewOrigin) return json({ error: "Request not permitted." }, 403);

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
    if (!config.enabled || !config.ready) return json({ error: "Manual audio sample is disabled." }, 409);
    const actorHash = crypto.createHash("sha256").update(actorUserId).digest("hex");
    const limit = await consumeRateLimit({ key: `promo-only-audio-sample:${actorHash}`, limit: 2,
      windowMs: 60 * 60_000 });
    if (!limit.allowed) return json({ error: "Manual audio sample rate limit reached." }, 429);

    const result = await importPromoOnlyAudioSample(prisma, { actorUserId, config });
    securityLog("info", "PROMOONLY_AUDIO_SAMPLE_RESULT", request, {
      actorUserId, imported: result.imported, reconciliationRequired: result.reconciliationRequired
    });
    return json({ result }, 200);
  } catch (error) {
    const code = safePromoOnlyAudioSampleCode(error);
    securityLog("error", "PROMOONLY_AUDIO_SAMPLE_UNAVAILABLE", request, { actorUserId, code });
    return json({ error: "The private audio sample did not complete safely.", code },
      code === "PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED" ||
      code === "PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE" ||
      code === "PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED" ? 409 : 502);
  }
}
