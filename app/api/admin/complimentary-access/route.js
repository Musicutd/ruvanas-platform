import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  complimentaryCodeSuffix,
  generateComplimentaryCode,
  hashComplimentaryCode
} from "@/lib/complimentary-access.mjs";

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
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can issue complimentary access." }, { status: 403 });
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

    const plainCode = generateComplimentaryCode();
    const created = await prisma.$transaction(async (tx) => {
      const code = await tx.complimentaryAccessCode.create({
        data: {
          codeHash: hashComplimentaryCode(plainCode),
          codeSuffix: complimentaryCodeSuffix(plainCode),
          organisationId: organisation.id,
          planId: plan.id,
          note: parsed.data.note || null,
          createdByUserId: access.user.id
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: access.user.id,
          action: "COMPLIMENTARY_ACCESS_CODE_ISSUED",
          entityType: "ComplimentaryAccessCode",
          entityId: code.id,
          details: { planId: plan.id, planCode: plan.code, codeSuffix: code.codeSuffix }
        }
      });
      return code;
    });

    return NextResponse.json({
      ok: true,
      code: plainCode,
      accessCode: { id: created.id, codeSuffix: created.codeSuffix, status: created.status },
      organisation: { id: organisation.id, name: organisation.name },
      plan: { id: plan.id, name: plan.name, code: plan.code }
    }, { status: 201 });
  } catch (error) {
    console.error("Issue complimentary access code error:", error);
    return NextResponse.json({ error: "Unable to issue the complimentary access code." }, { status: 500 });
  }
}
