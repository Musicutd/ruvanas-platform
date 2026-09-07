import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  complimentaryCodeSuffix,
  complimentaryPlanSnapshot,
  generateComplimentaryCode,
  hashComplimentaryCode
} from "@/lib/complimentary-access.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

const createSchema = z.object({
  organisationId: z.string().cuid(),
  planId: z.string().cuid(),
  note: z.string().trim().max(160).optional().nullable()
});

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can grant complimentary access." }, { status: 403 });
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose a client organisation and an active tier." }, { status: 400 });
    }

    const [organisation, plan] = await Promise.all([
      prisma.organisation.findUnique({ where: { id: parsed.data.organisationId }, select: { id: true, name: true, subscription: { select: { id: true } } } }),
      prisma.plan.findFirst({ where: { id: parsed.data.planId, active: true } })
    ]);
    if (!organisation || !organisation.subscription || !plan) {
      return NextResponse.json({ error: "The selected organisation or tier is unavailable." }, { status: 404 });
    }

    const internalCode = generateComplimentaryCode();
    const activatedAt = new Date();
    const created = await runSerializableTransaction(prisma, async (tx) => {
      const [currentSubscription, activeCode] = await Promise.all([
        tx.subscription.findUnique({ where: { id: organisation.subscription.id }, select: { complimentaryAccessActive: true } }),
        tx.complimentaryAccessCode.findFirst({ where: { organisationId: organisation.id, status: "ACTIVE" }, select: { id: true } })
      ]);
      if (currentSubscription?.complimentaryAccessActive || activeCode) throw new Error("COMPLIMENTARY_ACCESS_ACTIVE");
      await tx.complimentaryAccessCode.updateMany({
        where: { organisationId: organisation.id, status: "ISSUED" },
        data: { status: "REVOKED", revokedAt: activatedAt, revokedByUserId: access.user.id }
      });
      const code = await tx.complimentaryAccessCode.create({
        data: {
          codeHash: hashComplimentaryCode(internalCode),
          codeSuffix: complimentaryCodeSuffix(internalCode),
          organisationId: organisation.id,
          planId: plan.id,
          status: "ACTIVE",
          note: parsed.data.note || null,
          createdByUserId: access.user.id,
          redeemedByUserId: access.user.id,
          redeemedAt: activatedAt
        }
      });
      await tx.subscription.update({
        where: { id: organisation.subscription.id },
        data: {
          complimentaryAccessCodeId: code.id,
          complimentaryAccessActive: true,
          complimentaryAccessActivatedAt: activatedAt,
          ...complimentaryPlanSnapshot(plan)
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: access.user.id,
          action: "COMPLIMENTARY_ACCESS_GRANTED",
          entityType: "ComplimentaryAccessCode",
          entityId: code.id,
          details: { planId: plan.id, planCode: plan.code, codeSuffix: code.codeSuffix }
        }
      });
      return code;
    });

    return NextResponse.json({
      ok: true,
      access: { id: created.id, status: created.status, activatedAt },
      organisation: { id: organisation.id, name: organisation.name },
      plan: { id: plan.id, name: plan.name, code: plan.code }
    }, { status: 201 });
  } catch (error) {
    if (error?.message === "COMPLIMENTARY_ACCESS_ACTIVE") {
      return NextResponse.json({ error: "This organisation already has active complimentary access. Stop it before granting another tier." }, { status: 409 });
    }
    console.error("Grant complimentary access error:", error);
    return NextResponse.json({ error: "Unable to grant complimentary access." }, { status: 500 });
  }
}
