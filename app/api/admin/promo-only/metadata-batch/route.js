import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivatePreviewAdmin, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { readPromoOnlyMetadataBatchConfig } from "@/lib/promo-only-metadata-batch.mjs";
import { runPromoOnlyMetadataBatch } from "@/lib/promo-only-metadata-batch-service";
import { sampleRequestBodyIsEmpty } from "@/lib/promo-only-metadata-sample-service";
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
  return /^PROMOONLY_(?:BATCH|SAMPLE)_[A-Z0-9_]{1,72}$/.test(code) ? code : "PROMOONLY_BATCH_FAILED";
}

/** Owner-triggered API metadata only. No user-selected endpoint, queue or audio. */
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
    const config = readPromoOnlyMetadataBatchConfig(process.env);
    if (!config.enabled || !config.ready) return json({ error: "Manual metadata batch is disabled. Downloads must stay off." }, 409);

    // Persistent actor-bound limit cannot be bypassed with forwarded-IP changes.
    const actorHash = crypto.createHash("sha256").update(actorUserId).digest("hex");
    const limit = await consumeRateLimit({ key: `promo-only-metadata-batch:${actorHash}`, limit: 2, windowMs: HOUR_MS });
    if (!limit.allowed) return json({ error: "Metadata batch limit reached. Try again after one hour." }, 429);

    const result = await runPromoOnlyMetadataBatch(prisma, { actorUserId, config });
    securityLog("info", "PROMOONLY_METADATA_BATCH_IMPORTED", request, {
      actorUserId, createdCount: result.createdCount, updatedCount: result.updatedCount,
      unchangedCount: result.unchangedCount, skippedCount: result.skippedCount
    });
    // Only validated counts and supplier identifiers cross into the browser.
    return json({ result }, 200);
  } catch (error) {
    const code = safeCode(error);
    securityLog("error", "PROMOONLY_METADATA_BATCH_UNAVAILABLE", request, { actorUserId, code });
    const status = ["PROMOONLY_SAMPLE_CONNECTION_CONFLICT", "PROMOONLY_SAMPLE_DISABLED",
      "PROMOONLY_BATCH_DISABLED", "PROMOONLY_BATCH_CONNECTION_CONFLICT"].includes(code)
      ? 409 : code === "PROMOONLY_BATCH_FAILED" ? 503 : 502;
    return json({ error: "Metadata batch did not complete. No partial batch was saved.", code }, status);
  }
}
