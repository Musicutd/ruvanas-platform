import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { normaliseSchedulePayload, resolveMusicSchedule } from "@/lib/music-scheduling.mjs";
import {
  canManageSubscriberProgramming,
  previousProgrammingDate,
  publishedScheduleTransition,
  requirePublishPreview
} from "@/lib/subscriber-programming.mjs";

export const dynamic = "force-dynamic";

const scheduleSchema = z.object({
  targetType: z.enum(["LOCATION", "ZONE"]),
  targetId: z.string().cuid(),
  name: z.string().trim().min(2).max(120),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable(),
  publish: z.boolean().default(false),
  previewAcknowledged: z.boolean().optional().default(false),
  slots: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    startsAt: z.string(),
    endsAt: z.string(),
    musicModeId: z.string().cuid()
  })).min(1).max(200)
});

function safeSchedule(schedule) {
  return {
    id: schedule.id,
    name: schedule.name,
    targetType: schedule.zoneId ? "ZONE" : "LOCATION",
    targetId: schedule.zoneId || schedule.locationId,
    targetName: schedule.zone
      ? `${schedule.zone.location.name} / ${schedule.zone.name}`
      : schedule.location?.name || "Listening area",
    status: schedule.status,
    version: schedule.version,
    timezone: schedule.timezone,
    effectiveFrom: schedule.effectiveFrom?.toISOString().slice(0, 10) || null,
    effectiveTo: schedule.effectiveTo?.toISOString().slice(0, 10) || null,
    publishedAt: schedule.publishedAt?.toISOString() || null,
    updatedAt: schedule.updatedAt.toISOString(),
    slots: schedule.slots.map((slot) => ({
      id: slot.id,
      weekday: slot.weekday,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      musicModeId: slot.musicModeId,
      musicMode: slot.musicMode
    }))
  };
}

async function loadProgramming(organisationId, role) {
  const [locations, musicModes, schedules] = await Promise.all([
    prisma.location.findMany({
      where: { organisationId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        status: true,
        timezone: true,
        zones: {
          where: { status: "ACTIVE" },
          select: { id: true, name: true, status: true },
          orderBy: { name: "asc" }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.musicMode.findMany({
      where: { organisationId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        _count: { select: { tracks: true } }
      },
      orderBy: { name: "asc" }
    }),
    prisma.musicSchedule.findMany({
      where: { organisationId },
      include: {
        location: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true, location: { select: { id: true, name: true } } } },
        slots: {
          include: { musicMode: { select: { id: true, name: true, status: true } } },
          orderBy: [{ weekday: "asc" }, { startMinute: "asc" }]
        }
      },
      orderBy: [{ updatedAt: "desc" }, { version: "desc" }],
      take: 100
    })
  ]);

  const now = new Date();
  const targets = locations.flatMap((location) => [
    {
      id: location.id,
      type: "LOCATION",
      name: location.name,
      locationName: location.name,
      timezone: location.timezone,
      status: location.status
    },
    ...location.zones.map((zone) => ({
      id: zone.id,
      type: "ZONE",
      name: zone.name,
      locationName: location.name,
      timezone: location.timezone,
      status: zone.status
    }))
  ]);

  const safeSchedules = schedules.map(safeSchedule);
  const locationIdByZoneId = new Map(
    locations.flatMap((location) => location.zones.map((zone) => [zone.id, location.id]))
  );
  const liveTargets = targets.map((target) => {
    const locationId = target.type === "LOCATION" ? target.id : locationIdByZoneId.get(target.id);
    const relevant = schedules.filter((schedule) => (
      schedule.locationId === locationId ||
      (target.type === "ZONE" && schedule.zoneId === target.id)
    ));
    const current = resolveMusicSchedule({ schedules: relevant, instant: now, timezone: target.timezone });
    return {
      ...target,
      current: current.musicMode ? {
        musicModeId: current.musicMode.id,
        musicModeName: current.musicMode.name,
        scheduleId: current.scheduleId,
        reason: current.reason
      } : null
    };
  });

  return {
    generatedAt: now.toISOString(),
    canManage: canManageSubscriberProgramming(role),
    targets: liveTargets,
    musicModes: musicModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description,
      trackCount: mode._count.tracks
    })),
    schedules: safeSchedules
  };
}

export async function GET() {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    const serviceEnabled = resolveEntitlements(context.membership.organisation.subscription).serviceEnabled;
    if (!serviceEnabled) return NextResponse.json({ error: "Radio programming is unavailable while this service is inactive." }, { status: 403 });
    const programming = await loadProgramming(context.membership.organisationId, context.membership.role);
    return NextResponse.json({ ok: true, ...programming });
  } catch (error) {
    console.error("Subscriber programming load error:", error);
    return NextResponse.json({ error: "Unable to load radio programming." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
      return NextResponse.json({ error: "Radio programming is unavailable while this service is inactive." }, { status: 403 });
    }
    if (!canManageSubscriberProgramming(context.membership.role)) {
      return NextResponse.json({ error: "Only organisation owners and managers can change radio programming." }, { status: 403 });
    }

    const parsed = scheduleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Add a schedule name, listening area and at least one valid programme." }, { status: 400 });
    }
    const data = parsed.data;
    try {
      requirePublishPreview(data);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const organisationId = context.membership.organisationId;
    const target = data.targetType === "LOCATION"
      ? await prisma.location.findFirst({ where: { id: data.targetId, organisationId }, select: { id: true, timezone: true } })
      : await prisma.zone.findFirst({ where: { id: data.targetId, location: { organisationId } }, select: { id: true, location: { select: { id: true, timezone: true } } } });
    if (!target) return NextResponse.json({ error: "The selected listening area is not available to your organisation." }, { status: 404 });

    const timezone = data.targetType === "LOCATION" ? target.timezone : target.location.timezone;
    let normalised;
    try {
      normalised = normaliseSchedulePayload({
        ...data,
        timezone,
        slots: data.slots.map((slot) => ({ ...slot, priority: 0 }))
      });
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const modeIds = [...new Set(normalised.slots.map((slot) => slot.musicModeId))];
    const modes = await prisma.musicMode.findMany({
      where: { id: { in: modeIds }, organisationId, status: "ACTIVE" },
      select: { id: true }
    });
    if (modes.length !== modeIds.length) {
      return NextResponse.json({ error: "Choose only active music modes approved for your organisation." }, { status: 400 });
    }

    const targetWhere = data.targetType === "LOCATION" ? { locationId: target.id } : { zoneId: target.id };
    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.musicSchedule.findFirst({
        where: { organisationId, ...targetWhere },
        orderBy: { version: "desc" },
        select: { version: true }
      });
      if (data.publish) {
        const existingPublished = await tx.musicSchedule.findMany({
          where: { organisationId, ...targetWhere, status: "PUBLISHED" },
          select: { id: true, effectiveFrom: true, effectiveTo: true }
        });
        for (const existing of existingPublished) {
          const transition = publishedScheduleTransition(existing, normalised.effectiveFrom);
          if (transition === "ARCHIVE") {
            await tx.musicSchedule.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });
          } else if (transition === "END_BEFORE") {
            await tx.musicSchedule.update({
              where: { id: existing.id },
              data: { effectiveTo: new Date(`${previousProgrammingDate(normalised.effectiveFrom)}T00:00:00.000Z`) }
            });
          }
        }
      }
      const schedule = await tx.musicSchedule.create({
        data: {
          organisationId,
          locationId: data.targetType === "LOCATION" ? target.id : null,
          zoneId: data.targetType === "ZONE" ? target.id : null,
          name: data.name,
          version: (latest?.version || 0) + 1,
          status: data.publish ? "PUBLISHED" : "DRAFT",
          timezone,
          effectiveFrom: normalised.effectiveFrom ? new Date(`${normalised.effectiveFrom}T00:00:00.000Z`) : null,
          effectiveTo: normalised.effectiveTo ? new Date(`${normalised.effectiveTo}T00:00:00.000Z`) : null,
          publishedAt: data.publish ? new Date() : null,
          slots: { create: normalised.slots }
        },
        include: { slots: true }
      });
      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: context.user.id,
          action: data.publish ? "SUBSCRIBER_MUSIC_SCHEDULE_PUBLISHED" : "SUBSCRIBER_MUSIC_SCHEDULE_DRAFT_CREATED",
          entityType: "MusicSchedule",
          entityId: schedule.id,
          details: {
            targetType: data.targetType,
            targetId: target.id,
            version: schedule.version,
            slotCount: schedule.slots.length,
            approvedModesOnly: true,
            previewAcknowledged: data.previewAcknowledged
          }
        }
      });
      return schedule;
    });

    return NextResponse.json({ ok: true, schedule: created }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This listening area changed at the same time. Please retry." }, { status: 409 });
    console.error("Subscriber programming save error:", error);
    return NextResponse.json({ error: "Unable to save radio programming." }, { status: 500 });
  }
}
