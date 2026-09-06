import { NextResponse } from "next/server";
import { validatePublicStreamEndpoint } from "./stream-source-health.mjs";

export async function protectedLiveResponse(request, { streamUrl, authorizationHeaders = {}, userAgent = "Ruvanas-Protected-Relay/1.0", onDelivery = null }) {
  const url = await validatePublicStreamEndpoint(streamUrl);
  const upstream = await fetch(url, {
    method: "GET",
    headers: { Accept: "audio/*,*/*;q=0.1", "User-Agent": userAgent, ...authorizationHeaders },
    redirect: "manual",
    cache: "no-store",
    signal: request.signal
  });
  if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400) || !upstream.body) return NextResponse.json({ error: "The upstream live source is unavailable." }, { status: 502 });
  const contentType = String(upstream.headers.get("content-type") || "audio/mpeg").slice(0, 160);
  const baseType = contentType.toLowerCase().split(";", 1)[0];
  if (!baseType.startsWith("audio/") && !new Set(["application/ogg", "application/octet-stream"]).has(baseType)) {
    await upstream.body.cancel().catch(() => undefined);
    return NextResponse.json({ error: "The upstream endpoint did not return supported live audio." }, { status: 502 });
  }
  if (onDelivery) await onDelivery({ contentType });
  return new NextResponse(upstream.body, { headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
