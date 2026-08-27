import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { validateSchoolBroadcastSlot } from "@/lib/school-radio.mjs";

const slotSchema = z.object({
  announcementId: z.string().cuid(),
  locationId: z.string().cuid().optional().nullable(),
  zoneId: z.string().cuid().optional().nullable(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true })
});

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = slotSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Provide an approved announcement, target, start time, and end time." }, { status: 400 });
  let slotInput;
  try {
    slotInput = validateSchoolBroadcastSlot(parsed.data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The broadcast slot is invalid." }, { status: 400 });
  }
  if (slotInput.startsAt < new Date(Date.now() - 5 * 60 * 1000)) {
    return NextResponse.json({ error: "Schedule the announcement for the present or future." }, { status: 400 });
  }
  if (slotInput.endsAt.getTime() - slotInput.startsAt.getTime() > 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "A broadcast slot cannot be longer than 24 hours." }, { status: 400 });
  }
  const organisationId = access.organisation.id;
  const [announcement, location, zone] = await Promise.all([
    prisma.schoolAnnouncement.findFirst({ where: { id: parsed.data.announcementId, organisationId, status: "APPROVED" } }),
    slotInput.locationId ? prisma.location.findFirst({ where: { id: slotInput.locationId, organisationId, status: { not: "CLOSED" } } }) : null,
    slotInput.zoneId ? prisma.zone.findFirst({ where: { id: slotInput.zoneId, location: { organisationId }, status: { not: "OFFLINE" } } }) : null
  ]);
  if (!announcement) return NextResponse.json({ error: "Only an approved announcement can be scheduled." }, { status: 409 });
  if (slotInput.locationId && !location) return NextResponse.json({ error: "The selected location is unavailable." }, { status: 400 });
  if (slotInput.zoneId && !zone) return NextResponse.json({ error: "The selected zone is unavailable." }, { status: 400 });
  const overlap = await prisma.schoolBroadcastSlot.findFirst({
    where: {
      organisationId,
      status: "APPROVED",
      ...(slotInput.locationId ? { locationId: slotInput.locationId } : { zoneId: slotInput.zoneId }),
      startsAt: { lt: slotInput.endsAt },
      endsAt: { gt: slotInput.startsAt }
    },
    select: { id: true }
  });
  if (overlap) return NextResponse.json({ error: "That target already has an approved School Radio slot during this time." }, { status: 409 });
  const slot = await prisma.$transaction(async (tx) => {
    const created = await tx.schoolBroadcastSlot.create({
      data: {
        organisationId,
        announcementId: announcement.id,
        ...slotInput,
        approvedByUserId: access.user.id
      }
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId: access.user.id,
        action: "SCHOOL_BROADCAST_SLOT_APPROVED",
        entityType: "SchoolBroadcastSlot",
        entityId: created.id,
        details: { announcementId: announcement.id, locationId: created.locationId, zoneId: created.zoneId, startsAt: created.startsAt.toISOString(), endsAt: created.endsAt.toISOString() }
      }
    });
    return created;
  });
  return NextResponse.json({ slot }, { status: 201 });
}
