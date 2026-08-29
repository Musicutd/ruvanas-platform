import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";

const cancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function PATCH(request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = cancelSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Provide a short reason for removing the notice." }, { status: 400 });
  const current = await prisma.schoolNoticeboardPost.findFirst({
    where: { id: String(params.postId || ""), organisationId: access.organisation.id },
    select: { id: true, status: true }
  });
  if (!current) return NextResponse.json({ error: "The noticeboard post was not found." }, { status: 404 });
  if (current.status !== "SCHEDULED") return NextResponse.json({ error: "This noticeboard post is already cancelled." }, { status: 409 });
  const now = new Date();
  const post = await prisma.$transaction(async (tx) => {
    const updated = await tx.schoolNoticeboardPost.update({
      where: { id: current.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledByUserId: access.user.id,
        cancellationReason: parsed.data.reason
      }
    });
    await tx.auditLog.create({
      data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: "SCHOOL_NOTICEBOARD_CANCELLED",
        entityType: "SchoolNoticeboardPost",
        entityId: current.id,
        details: { reason: parsed.data.reason }
      }
    });
    return updated;
  });
  return NextResponse.json({ post });
}
