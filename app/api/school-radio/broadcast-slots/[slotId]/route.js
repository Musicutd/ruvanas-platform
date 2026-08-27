import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";

const cancelSchema = z.object({ reason: z.string().trim().min(2).max(500) });

export async function PATCH(request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = cancelSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Provide a short cancellation reason." }, { status: 400 });
  const slot = await prisma.schoolBroadcastSlot.findFirst({
    where: { id: String(params.slotId || ""), organisationId: access.organisation.id, status: "APPROVED" }
  });
  if (!slot) return NextResponse.json({ error: "The active broadcast slot was not found." }, { status: 404 });
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.schoolBroadcastSlot.update({
      where: { id: slot.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: parsed.data.reason }
    });
    await tx.auditLog.create({
      data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: "SCHOOL_BROADCAST_SLOT_CANCELLED",
        entityType: "SchoolBroadcastSlot",
        entityId: slot.id,
        details: { reason: parsed.data.reason }
      }
    });
    return item;
  });
  return NextResponse.json({ slot: updated });
}
