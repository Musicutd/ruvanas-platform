import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { appendProductionCreditEntry, productionCreditSummary } from "@/lib/production-credit-service";
import { requireActiveStudio } from "@/lib/studio-access";

export const dynamic = "force-dynamic";

const entrySchema = z.object({
  entryType: z.enum(["GRANT", "EXPIRY", "ADJUSTMENT"]),
  quantity: z.number().int().min(-100000).max(100000).refine((value) => value !== 0),
  note: z.string().trim().min(3).max(1000),
  externalReference: z.string().trim().max(240).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable()
});

export async function GET() {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ credits: await productionCreditSummary(prisma, access.organisation.id) });
}

export async function POST(request) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can manage production credits." }, { status: 403 });

  const parsed = entrySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid credit entry and an audit note." }, { status: 400 });
  if (parsed.data.entryType !== "ADJUSTMENT" && parsed.data.quantity < 1) {
    return NextResponse.json({ error: "Grant and expiry quantities must be positive." }, { status: 400 });
  }

  const idempotencyKey = String(request.headers.get("idempotency-key") || "").trim();
  if (!idempotencyKey) return NextResponse.json({ error: "An Idempotency-Key header is required." }, { status: 400 });
  try {
    const entry = await prisma.$transaction(async (tx) => {
      const created = await appendProductionCreditEntry(tx, {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        entryType: parsed.data.entryType,
        quantity: parsed.data.quantity,
        idempotencyKey,
        externalReference: parsed.data.externalReference,
        note: parsed.data.note,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
      });
      await tx.auditLog.create({
        data: {
          organisationId: access.organisation.id,
          actorUserId: access.user.id,
          action: `PRODUCTION_CREDIT_${parsed.data.entryType}`,
          entityType: "ProductionCreditLedgerEntry",
          entityId: created.id,
          details: { quantity: created.quantity, availableAfter: created.availableAfter, reservedAfter: created.reservedAfter, externalReference: created.externalReference }
        }
      });
      return created;
    });
    return NextResponse.json({ entry, credits: await productionCreditSummary(prisma, access.organisation.id) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The production-credit entry could not be recorded.";
    return NextResponse.json({ error: message }, { status: message.includes("enough") ? 409 : 400 });
  }
}

