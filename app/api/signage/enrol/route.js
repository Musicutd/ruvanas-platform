import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { digitalSignageTokenHash, setDigitalSignageDeviceCookie } from "@/lib/digital-signage-device-auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

export async function POST(request) {
  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) return NextResponse.json({ error: "Enter the display enrolment code." }, { status: 400 });
    const enrolmentTokenHash = digitalSignageTokenHash(code);
    const sessionToken = createPlayerToken();
    const now = new Date();
    const device = await prisma.$transaction(async (tx) => {
      const pending = await tx.digitalSignageDevice.findUnique({
        where: { enrolmentTokenHash },
        include: { organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } } }
      });
      if (!pending || pending.status === "DISABLED" || !pending.enrolmentExpiresAt || pending.enrolmentExpiresAt <= now || !resolveEntitlements(pending.organisation.subscription).digitalSignageEnabled) return null;
      const enrolled = await tx.digitalSignageDevice.update({
        where: { id: pending.id },
        data: { status: "ONLINE", enrolmentTokenHash: null, enrolmentExpiresAt: null, sessionTokenHash: digitalSignageTokenHash(sessionToken), enrolledAt: now, lastHeartbeatAt: now }
      });
      await tx.auditLog.create({ data: { organisationId: pending.organisationId, action: "DIGITAL_SIGNAGE_DEVICE_ENROLLED", entityType: "DigitalSignageDevice", entityId: pending.id, details: { zoneId: pending.zoneId } } });
      return enrolled;
    });
    if (!device) return NextResponse.json({ error: "This display enrolment code is invalid, expired, already used, or no longer entitled." }, { status: 400 });
    setDigitalSignageDeviceCookie(sessionToken);
    return NextResponse.json({ ok: true, deviceId: device.id });
  } catch (error) {
    console.error("Digital signage enrolment error:", error);
    return NextResponse.json({ error: "Unable to enrol this display." }, { status: 500 });
  }
}
