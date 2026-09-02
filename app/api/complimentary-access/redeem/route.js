import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import {
  canRedeemComplimentaryAccess,
  complimentaryPlanSnapshot,
  hashComplimentaryCode
} from "@/lib/complimentary-access.mjs";

const redeemSchema = z.object({ code: z.string().trim().min(12).max(64) });

export async function POST(request) {
  try {
    const context = await getActiveOrganisationContext({ subscription: true });
    if (!context) return NextResponse.json({ error: "Sign in to activate complimentary access." }, { status: 401 });
    if (!context.membership || !canRedeemComplimentaryAccess(context.membership.role)) {
      return NextResponse.json({ error: "Only an organisation owner or manager can activate a code." }, { status: 403 });
    }

    const parsed = redeemSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter the complete complimentary access code." }, { status: 400 });
    const codeHash = hashComplimentaryCode(parsed.data.code);
    const accessCode = await prisma.complimentaryAccessCode.findUnique({
      where: { codeHash },
      include: { plan: true }
    });
    if (!accessCode || accessCode.organisationId !== context.membership.organisationId) {
      return NextResponse.json({ error: "This code is not valid for the selected organisation." }, { status: 404 });
    }
    if (accessCode.status !== "ISSUED") {
      return NextResponse.json({ error: accessCode.status === "ACTIVE" ? "This code has already been activated." : "This code has been stopped by Ruvanas." }, { status: 409 });
    }
    const subscription = context.membership.organisation.subscription;
    if (!subscription) return NextResponse.json({ error: "This organisation does not have a service record." }, { status: 409 });
    if (subscription.complimentaryAccessActive) {
      return NextResponse.json({ error: "Complimentary access is already active. Ask Ruvanas to stop it before using another code." }, { status: 409 });
    }

    const activatedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.complimentaryAccessCode.updateMany({
        where: { id: accessCode.id, status: "ISSUED" },
        data: { status: "ACTIVE", redeemedAt: activatedAt, redeemedByUserId: context.user.id }
      });
      if (claimed.count !== 1) throw new Error("CODE_ALREADY_CLAIMED");
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          complimentaryAccessCodeId: accessCode.id,
          complimentaryAccessActive: true,
          complimentaryAccessActivatedAt: activatedAt,
          ...complimentaryPlanSnapshot(accessCode.plan)
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: accessCode.organisationId,
          actorUserId: context.user.id,
          action: "COMPLIMENTARY_ACCESS_ACTIVATED",
          entityType: "ComplimentaryAccessCode",
          entityId: accessCode.id,
          details: { planId: accessCode.planId, planCode: accessCode.plan.code, codeSuffix: accessCode.codeSuffix }
        }
      });
      return updated;
    });

    return NextResponse.json({
      ok: true,
      access: {
        active: result.complimentaryAccessActive,
        planName: result.complimentaryPlanName,
        activatedAt: result.complimentaryAccessActivatedAt
      }
    });
  } catch (error) {
    if (error?.message === "CODE_ALREADY_CLAIMED") {
      return NextResponse.json({ error: "This code was already activated." }, { status: 409 });
    }
    console.error("Redeem complimentary access error:", error);
    return NextResponse.json({ error: "Unable to activate complimentary access." }, { status: 500 });
  }
}
