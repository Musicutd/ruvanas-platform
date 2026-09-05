import { NextResponse } from "next/server";
import { ingestListenerAnalytics } from "@/lib/listener-analytics-service";
import { prisma } from "@/lib/prisma";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function POST(request) {
  try {
    const text = await request.text();
    if (text.length > 32_768) return NextResponse.json({ error: "The listener event batch is too large." }, { status: 413 });
    let body;
    try { body = JSON.parse(text); }
    catch { return NextResponse.json({ error: "Send a valid listener event batch." }, { status: 400 }); }
    const result = await ingestListenerAnalytics(prisma, { token: bearerToken(request), body });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ accepted: result.accepted, received: result.received }, {
      status: 202,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The listener event batch could not be accepted.";
    if (/listener event|Listening time|supported listener|reported close/.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    securityLog("error", "LISTENER_ANALYTICS_INGESTION_FAILED", request, { errorCode: error?.code || error?.name || "UNKNOWN" });
    return NextResponse.json({ error: "The listener event batch could not be accepted." }, { status: 500 });
  }
}
