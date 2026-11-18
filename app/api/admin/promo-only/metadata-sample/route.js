import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivatePreviewAdminSession, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { readPromoOnlyMetadataSampleConfig } from "@/lib/promo-only-metadata-sample.mjs";
import { runPromoOnlyMetadataSample, sampleRequestBodyIsEmpty } from "@/lib/promo-only-metadata-sample-service";
import { consumeRateLimit } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive"
});
const HOUR_MS = 60 * 60_000;

function json(body, status) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function safeCode(error) {
  const code = String(error?.code || "");
  return /^PROMOONLY_[A-Z0-9_]{1,72}$/.test(code) ? code : "PROMOONLY_SAMPLE_FAILED";
}

export async function POST(request) {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return json({ error: "Private preview is unavailable." }, 503);
  if (request.headers.get("origin") !== policy.previewOrigin) return json({ error: "Request not permitted." }, 403);

  let actorUserId = null;
  try {
    const session = await getCurrentSession();
    if (!isPrivatePreviewAdminSession(session, policy)) {
      return json({ error: "Access denied." }, 403);
    }
    actorUserId = session.userId;
    if (new URL(request.url).search || !(await sampleRequestBodyIsEmpty(request))) {
      return json({ error: "This action accepts no input." }, 400);
    }
    const config = readPromoOnlyMetadataSampleConfig(process.env);
    if (!config.enabled || !config.ready) return json({ error: "Manual metadata sample is disabled." }, 409);

    // The key is actor-bound, not client-IP-bound; forwarded headers cannot
    // increase the two-attempt hourly supplier budget.
    const actorHash = crypto.createHash("sha256").update(actorUserId).digest("hex");
    const limit = await consumeRateLimit({ key: `promo-only-metadata-sample:${actorHash}`, limit: 2, windowMs: HOUR_MS });
    if (!limit.allowed) return json({ error: "Manual metadata sample rate limit reached." }, 429);

    const result = await runPromoOnlyMetadataSample(prisma, { actorUserId, config });
    securityLog("info", "PROMOONLY_METADATA_SAMPLE_IMPORTED", request, {
      actorUserId, createdCount: result.createdCount, updatedCount: result.updatedCount,
      unchangedCount: result.unchangedCount
    });
    // Supplier payloads, credentials, tokens and provider media URLs stay server-side.
    return json({ result }, 200);
  } catch (error) {
    const code = safeCode(error);
    securityLog("error", "PROMOONLY_METADATA_SAMPLE_UNAVAILABLE", request, { actorUserId, code });
    const status = ["PROMOONLY_SAMPLE_CONNECTION_CONFLICT", "PROMOONLY_SAMPLE_MEDIA_EXISTS",
      "PROMOONLY_SAMPLE_DISABLED"].includes(code) ? 409 : code === "PROMOONLY_SAMPLE_FAILED" ? 503 : 502;
    return json({ error: "Manual metadata sample did not complete.", code }, status);
  }
}
