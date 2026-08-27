import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { transitionSchoolAnnouncement } from "@/lib/school-radio.mjs";

const reviewSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "REQUEST_CHANGES", "REJECT", "ARCHIVE"]),
  notes: z.string().trim().max(1000).optional().nullable()
});

export async function PATCH(request, { params }) {
  const parsed = reviewSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid review action." }, { status: 400 });
  const allowedRoles = parsed.data.action === "SUBMIT" ? ORGANISATION_CONTENT_ROLES : ORGANISATION_MANAGER_ROLES;
  const access = await requireActiveSchoolRadio(allowedRoles);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const announcement = await prisma.schoolAnnouncement.findFirst({
    where: { id: String(params.announcementId || ""), organisationId: access.organisation.id }
  });
  if (!announcement) return NextResponse.json({ error: "The announcement was not found." }, { status: 404 });
  let transition;
  try {
    transition = transitionSchoolAnnouncement({ currentStatus: announcement.status, action: parsed.data.action, notes: parsed.data.notes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "This review action is not allowed." }, { status: 409 });
  }
  if (parsed.data.action !== "SUBMIT") transition.reviewedByUserId = access.user.id;
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.schoolAnnouncement.update({ where: { id: announcement.id }, data: transition });
    await tx.auditLog.create({
      data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: `SCHOOL_ANNOUNCEMENT_${parsed.data.action}`,
        entityType: "SchoolAnnouncement",
        entityId: announcement.id,
        details: { fromStatus: announcement.status, toStatus: item.status, notes: transition.reviewNotes || null }
      }
    });
    return item;
  });
  return NextResponse.json({ announcement: updated });
}
