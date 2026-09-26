import { NextResponse } from "next/server";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { getRequestId } from "@/lib/security-log";
import { createFamilyCorrectionsRequest } from "@/lib/corrections-requests-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const generic = () => NextResponse.json({ ok: true, message: "Your request has been received for review." }, { status: 202, headers: { "Cache-Control": "no-store" } });
  const raw = await request.text();
  if (raw.length > 3_000) return NextResponse.json({ error: "The request is too long." }, { status: 413 });
  let input;
  try { input = JSON.parse(raw); } catch { return NextResponse.json({ error: "Check the request form." }, { status: 400 }); }
  const [globalLimit, facilityLimit] = await Promise.all([
    consumeRateLimit({ key: createRateLimitKey("inside-family-ip", request), limit: 20, windowMs: 60 * 60_000 }),
    consumeRateLimit({ key: createRateLimitKey("inside-family-facility", request, String(input?.facilityCode || "").slice(0, 40)), limit: 5, windowMs: 60 * 60_000 })
  ]);
  if (!globalLimit.allowed || !facilityLimit.allowed) return NextResponse.json({ error: "Please wait before sending another request." }, { status: 429, headers: { "Retry-After": String(Math.max(globalLimit.retryAfterSeconds, facilityLimit.retryAfterSeconds)) } });
  if (input?.website) return generic(); // honeypot; no public indication
  try { await createFamilyCorrectionsRequest(input, { requestId: getRequestId(request), secret: process.env.SESSION_SECRET }); return generic(); }
  catch (error) {
    if (error?.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Corrections public request failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The request could not be received right now." }, { status: 503 });
  }
}
