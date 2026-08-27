import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { normaliseSchedulePayload } from "@/lib/music-scheduling.mjs";

export const dynamic = "force-dynamic";

const schema = z.object({
  organisationId: z.string().cuid(),
  targetType: z.enum(["LOCATION", "ZONE"]),
  targetId: z.string().cuid(),
  name: z.string().trim().min(1).max(120),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable(),
  publish: z.boolean().default(false),
  slots: z.array(z.object({
    weekday: z.number().int(),
    startsAt: z.string(),
    endsAt: z.string(),
    musicModeId: z.string().cuid(),
    priority: z.number().int().default(0)
  }))
});

function denyUnlessSuperAdmin(access) {
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can manage music schedules." }, { status: 403 });
  return null;
}

export async function GET() {
  try {
    const access = await requirePlatformAdmin();
    const denied = denyUnlessSuperAdmin(access);
    if (denied) return denied;
    const schedules = await prisma.musicSchedule.findMany({
      include: {
        organisation: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true, location: { select: { name: true } } } },
        slots: { include: { musicMode: { select: { id: true, name: true, status: true } } }, orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }
      },
      orderBy: [{ createdAt: "desc" }]
    });
    return NextResponse.json({ schedules });
  } catch (error) {
    console.error("List music schedules error:", error);
    return NextResponse.json({ error: "Unable to load music schedules." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    const denied = denyUnlessSuperAdmin(access);
    if (denied) return denied;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid schedule, target, and time slots." }, { status: 400 });

    const data = parsed.data;
    const target = data.targetType === "LOCATION"
      ? await prisma.location.findUnique({ where: { id: data.targetId }, select: { id: true, organisationId: true, timezone: true } })
      : await prisma.zone.findUnique({ where: { id: data.targetId }, select: { id: true, location: { select: { id: true, organisationId: true, timezone: true } } } });
    const targetOrganisationId = data.targetType === "LOCATION" ? target?.organisationId : target?.location.organisationId;
    const timezone = data.targetType === "LOCATION" ? target?.timezone : target?.location.timezone;
    if (!target) return NextResponse.json({ error: "The selected schedule target does not exist." }, { status: 404 });
    if (targetOrganisationId !== data.organisationId) return NextResponse.json({ error: "The selected target does not belong to this organisation." }, { status: 400 });

    let normalised;
    try {
      normalised = normaliseSchedulePayload({ ...data, timezone });
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const modeIds = [...new Set(normalised.slots.map((slot) => slot.musicModeId))];
    const modes = await prisma.musicMode.findMany({ where: { id: { in: modeIds } }, select: { id: true, organisationId: true, status: true } });
    if (modes.length !== modeIds.length || modes.some((mode) => mode.organisationId !== data.organisationId)) {
      return NextResponse.json({ error: "Every music mode must belong to the selected organisation." }, { status: 400 });
    }
    if (data.publish && modes.some((mode) => mode.status !== "ACTIVE")) {
      return NextResponse.json({ error: "Only active music modes may be placed in a published schedule." }, { status: 400 });
    }

    const targetWhere = data.targetType === "LOCATION" ? { locationId: target.id } : { zoneId: target.id };
    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.musicSchedule.findFirst({ where: targetWhere, orderBy: { version: "desc" }, select: { version: true } });
      if (data.publish) await tx.musicSchedule.updateMany({ where: { ...targetWhere, status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
      const schedule = await tx.musicSchedule.create({
        data: {
          organisationId: data.organisationId,
          locationId: data.targetType === "LOCATION" ? target.id : null,
          zoneId: data.targetType === "ZONE" ? target.id : null,
          name: data.name,
          version: (latest?.version || 0) + 1,
          status: data.publish ? "PUBLISHED" : "DRAFT",
          timezone: normalised.timezone,
          effectiveFrom: normalised.effectiveFrom ? new Date(`${normalised.effectiveFrom}T00:00:00.000Z`) : null,
          effectiveTo: normalised.effectiveTo ? new Date(`${normalised.effectiveTo}T00:00:00.000Z`) : null,
          publishedAt: data.publish ? new Date() : null,
          slots: { create: normalised.slots }
        },
        include: { slots: true }
      });
      await tx.auditLog.create({ data: {
        organisationId: data.organisationId,
        actorUserId: access.user.id,
        action: data.publish ? "MUSIC_SCHEDULE_PUBLISHED" : "MUSIC_SCHEDULE_DRAFT_CREATED",
        entityType: "MusicSchedule",
        entityId: schedule.id,
        details: { targetType: data.targetType, targetId: target.id, version: schedule.version, slotCount: schedule.slots.length, timezone: schedule.timezone }
      } });
      return schedule;
    });
    return NextResponse.json({ ok: true, schedule: created }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This schedule target was updated at the same time. Please retry." }, { status: 409 });
    console.error("Create music schedule error:", error);
    return NextResponse.json({ error: "Unable to create the music schedule." }, { status: 500 });
  }
}
