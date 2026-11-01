import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { claimPlayerListenerLease, readPlayerInstanceId } from "@/lib/player-listener-lease.mjs";
import { recordRetailStreamEvidence, normalizeRetailStreamEvidence } from "@/lib/retail-test-stream-evidence.mjs";
import { readPrivatePreviewBody, PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";

export async function POST(request) {
  try {
    const origin = process.env.RUVANAS_PRIVATE_PREVIEW_ENABLED === "1" ? "https://www.ruvanas.com" : new URL(request.url).origin;
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site")
      return NextResponse.json({ error: "This request is not permitted." }, { status: 403, headers });
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED") return NextResponse.json({ error: "This device is not enrolled." }, { status: 401, headers });
    if (!player.subscriberTestStream) return NextResponse.json({ error: "Stream reporting is unavailable for this device." }, { status: 403, headers });
    let input;
    try { input = await readPrivatePreviewBody(request, ["state", "positionSeconds", "observedAt"]); }
    catch { return NextResponse.json({ error: "The stream report is invalid." }, { status: 400, headers }); }
    if (!normalizeRetailStreamEvidence(input)) return NextResponse.json({ error: "The stream report is invalid or out of date." }, { status: 400, headers });
    const lease = await claimPlayerListenerLease(prisma, { player, instanceId: readPlayerInstanceId(request) });
    if (!lease.ok) return NextResponse.json(lease, { status: lease.status, headers });
    const evidence = await recordRetailStreamEvidence(prisma, { player, input });
    if (!evidence) return NextResponse.json({ error: "The stream report is invalid or out of date." }, { status: 400, headers });
    return NextResponse.json({ ok: true, evidenceType: "DEVICE_REPORTED_STREAM_ONLY", progressObserved: evidence.progressObserved }, { headers });
  } catch {
    return NextResponse.json({ error: "Unable to record this device's stream report." }, { status: 503, headers });
  }
}
