import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivatePreviewAdminSession, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { readPromoOnlyAudioSampleConfig } from "@/lib/promo-only-audio-sample.mjs";
import { resolvePromoOnlyAudioSampleAsset } from "@/lib/promo-only-audio-sample-service";
import { protectedAudioResponse } from "@/lib/protected-audio-response";

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

export async function GET(request) {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return json({ error: "Private preview is unavailable." }, 503);
  const origin = request.headers.get("origin");
  if (origin && origin !== policy.previewOrigin) return json({ error: "Request not permitted." }, 403);
  if (new URL(request.url).search) return json({ error: "This preview accepts no track selection." }, 400);
  try {
    const session = await getCurrentSession();
    if (!isPrivatePreviewAdminSession(session, policy)) {
      return json({ error: "Access denied." }, 403);
    }
    const config = readPromoOnlyAudioSampleConfig(process.env);
    if (!config.enabled || !config.ready) return json({ error: "Not found." }, 404);
    const asset = await resolvePromoOnlyAudioSampleAsset(prisma, { actorUserId: session.userId, config });
    if (!asset) return json({ error: "No private sample is available." }, 404);
    const response = await protectedAudioResponse(request, asset);
    for (const [name, value] of Object.entries(RESPONSE_HEADERS)) response.headers.set(name, value);
    return response;
  } catch {
    return json({ error: "Private audio is unavailable." }, 503);
  }
}
