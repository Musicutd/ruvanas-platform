import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import {
  hashPartnerDemoToken,
  newPartnerDemoSessionToken,
  PARTNER_DEMO_COOKIE,
  PARTNER_DEMO_SESSION_DAYS,
  redeemPartnerDemoSchema
} from "@/lib/partner-demo-access.mjs";
import { securityLog } from "@/lib/security-log";

export async function POST(request) {
  const rateLimit = await consumeRateLimit({
    key: createRateLimitKey("partner-demo-redeem", request),
    limit: 5,
    windowMs: 60 * 60 * 1000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, {
      status: 429,
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) }
    });
  }

  const parsed = redeemPartnerDemoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the email and complete invitation code." }, { status: 400 });
  }

  const now = new Date();
  const codeHash = hashPartnerDemoToken(parsed.data.code);
  const invalid = () => NextResponse.json({ error: "This invitation is invalid, expired, or already used." }, { status: 400 });

  try {
    const invitation = await prisma.partnerDemoInvitation.findUnique({ where: { codeHash } });
    if (!invitation || invitation.recipientEmail !== parsed.data.email || invitation.revokedAt || invitation.redeemedAt || invitation.codeExpiresAt <= now) {
      securityLog("warn", "PARTNER_DEMO_REDEEM_REJECTED", request, { reason: "invalid_or_expired" });
      return invalid();
    }

    const sessionToken = newPartnerDemoSessionToken();
    const sessionExpiresAt = new Date(now.getTime() + PARTNER_DEMO_SESSION_DAYS * 24 * 60 * 60 * 1000);
    const redeemed = await prisma.$transaction(async (tx) => {
      const changed = await tx.partnerDemoInvitation.updateMany({
        where: { id: invitation.id, codeHash, redeemedAt: null, revokedAt: null, codeExpiresAt: { gt: now } },
        data: {
          codeHash: null,
          sessionHash: hashPartnerDemoToken(sessionToken),
          sessionExpiresAt,
          redeemedAt: now,
          lastViewedAt: now
        }
      });
      if (!changed.count) return false;
      await tx.auditLog.create({ data: {
        action: "PARTNER_DEMO_REDEEMED",
        entityType: "PartnerDemoInvitation",
        entityId: invitation.id,
        details: { sessionExpiresAt: sessionExpiresAt.toISOString() }
      } });
      return true;
    });
    if (!redeemed) return invalid();

    const response = NextResponse.json({ ok: true, destination: "/partner-demo" }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(PARTNER_DEMO_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: sessionExpiresAt
    });
    securityLog("info", "PARTNER_DEMO_REDEEMED", request, { invitationId: invitation.id });
    return response;
  } catch (error) {
    securityLog("error", "PARTNER_DEMO_REDEEM_ERROR", request, { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Unable to open the demo. Please try again." }, { status: 500 });
  }
}
