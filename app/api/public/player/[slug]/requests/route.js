import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadPublicPlayerStation, publicPlayerTarget } from "@/lib/public-player-service";
import { normalizePublicListenerSessionId, publicListenerSessionHash, PUBLIC_LISTENER_SESSION_HEADER } from "@/lib/public-player.mjs";
import { createListenerRequestDedupeKey, LISTENER_REQUEST_RATE_LIMIT, LISTENER_REQUEST_RATE_WINDOW_MS, normalizeListenerRequest } from "@/lib/listener-interaction.mjs";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import { getRequestId } from "@/lib/security-log";
import { assertNoSensitiveHealthFields } from "@/lib/health-faith-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(error, status, headers = {}) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request, { params }) {
  try {
    const instant = new Date();
    const station = await loadPublicPlayerStation(prisma, String(params.slug || ""));
    if (!station) return response("This public station is unavailable.", 404);
    if (!station.listenerRequestsEnabled) return response("This station is not accepting listener requests right now.", 403);
    const target = publicPlayerTarget(station, instant);
    if (!target) return response("This station does not yet have an active public channel.", 409);

    const sessionId = normalizePublicListenerSessionId(request.headers.get(PUBLIC_LISTENER_SESSION_HEADER));
    if (!sessionId) return response("Start the public player before sending a request.", 401);
    const sessionHash = publicListenerSessionHash(sessionId);
    const lease = await prisma.publicListenerLease.findUnique({ where: { stationId_sessionHash: { stationId: station.id, sessionHash } }, select: { channelId: true, expiresAt: true } });
    if (!lease || lease.channelId !== target.channel.id || lease.expiresAt <= instant) return response("Your listening session has expired. Reconnect and try again.", 401);
    const blocked = await prisma.listenerRequestBlock.findUnique({ where: { stationId_sessionHash: { stationId: station.id, sessionHash } }, select: { active: true } });
    if (blocked?.active) return response("Requests from this listening session are not available.", 403);

    const rateLimit = await consumeRateLimit({ key: createRateLimitKey("listener-request", request, `${station.id}:${sessionId}`), limit: LISTENER_REQUEST_RATE_LIMIT, windowMs: LISTENER_REQUEST_RATE_WINDOW_MS });
    if (!rateLimit.allowed) return response("Please wait before sending another request.", 429, { "Retry-After": String(rateLimit.retryAfterSeconds) });
    const raw = await request.text();
    if (raw.length > 4_096) return response("The request is too large.", 413);
    let input;
    try {
      const payload = JSON.parse(raw);
      if (station.productFamily === "HEALTH") assertNoSensitiveHealthFields(payload);
      input = normalizeListenerRequest({ ...payload, message: station.productFamily === "HEALTH" ? null : payload.message });
    }
    catch (error) { return response(error instanceof Error ? error.message : "Check the song request.", 400); }
    const dedupeKey = createListenerRequestDedupeKey({ stationId: station.id, sessionHash, ...input, instant, secret: process.env.SESSION_SECRET });
    const operationRequestId = getRequestId(request);

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const value = await tx.listenerRequest.create({ data: { organisationId: station.organisationId, stationId: station.id, channelId: target.channel.id, sessionHash, dedupeKey, ...input }, select: { id: true, createdAt: true } });
        await enqueueNotificationEvent(tx, {
          organisationId: station.organisationId,
          type: "LISTENER_REQUEST",
          severity: "INFO",
          title: "New listener request",
          message: `${input.artist} — ${input.title} is waiting for moderation.`,
          entityType: "ListenerRequest",
          entityId: value.id,
          dedupeKey: `listener-request:${value.id}`,
          correlationId: operationRequestId,
          requestId: operationRequestId
        });
        return value;
      });
    } catch (error) {
      if (error?.code === "P2002") return response("This song was already requested recently.", 409);
      throw error;
    }
    return NextResponse.json({ ok: true, acceptedAt: created.createdAt, message: "Your request was sent for station review." }, { status: 201, headers: { "Cache-Control": "no-store", "X-RateLimit-Remaining": String(rateLimit.remaining) } });
  } catch (error) {
    console.error("Public listener request failed:", error?.code || error?.name || "UNKNOWN");
    return response("The request could not be sent right now.", 500);
  }
}
