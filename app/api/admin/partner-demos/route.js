import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createPartnerDemoSchema,
  hashPartnerDemoToken,
  newPartnerDemoCode,
  PARTNER_DEMO_CODE_HOURS
} from "@/lib/partner-demo-access.mjs";
import { securityLog } from "@/lib/security-log";

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Super Admin access is required." }, { status: 403 });
  }

  const parsed = createPartnerDemoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a partner name and valid recipient email." }, { status: 400 });
  }

  try {
    const code = newPartnerDemoCode();
    const expiresAt = new Date(Date.now() + PARTNER_DEMO_CODE_HOURS * 60 * 60 * 1000);
    const invitation = await prisma.$transaction(async (tx) => {
      const created = await tx.partnerDemoInvitation.create({ data: {
        partnerName: parsed.data.partnerName,
        recipientEmail: parsed.data.recipientEmail,
        codeHash: hashPartnerDemoToken(code),
        codeSuffix: code.slice(-6),
        codeExpiresAt: expiresAt,
        createdByUserId: user.id
      } });
      await tx.auditLog.create({ data: {
        actorUserId: user.id,
        action: "PARTNER_DEMO_INVITED",
        entityType: "PartnerDemoInvitation",
        entityId: created.id,
        details: { codeExpiresAt: expiresAt.toISOString() }
      } });
      return created;
    });
    securityLog("info", "PARTNER_DEMO_INVITED", request, { invitationId: invitation.id, actorUserId: user.id });
    return NextResponse.json({ code, expiresAt: expiresAt.toISOString(), id: invitation.id }, {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    securityLog("error", "PARTNER_DEMO_INVITE_ERROR", request, { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Unable to create the partner invitation." }, { status: 500 });
  }
}
