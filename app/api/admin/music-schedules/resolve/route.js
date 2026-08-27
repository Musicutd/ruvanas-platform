import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { evaluateLocationOpen } from "@/lib/opening-hours.mjs";
import { resolveMusicSchedule } from "@/lib/music-scheduling.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can preview music schedules." }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const zoneId = searchParams.get("zoneId");
    const instant = searchParams.get("at") ? new Date(searchParams.get("at")) : new Date();
    if (!zoneId || Number.isNaN(instant.valueOf())) return NextResponse.json({ error: "Enter a valid zone and optional ISO timestamp." }, { status: 400 });

    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: {
        location: { include: { openingHours: true, openingExceptions: true } }
      }
    });
    if (!zone) return NextResponse.json({ error: "Zone not found." }, { status: 404 });

    const opening = evaluateLocationOpen({
      instant,
      timezone: zone.location.timezone,
      weeklyHours: zone.location.openingHours,
      exceptions: zone.location.openingExceptions
    });
    const schedules = await prisma.musicSchedule.findMany({
      where: {
        organisationId: zone.location.organisationId,
        status: "PUBLISHED",
        OR: [{ zoneId: zone.id }, { locationId: zone.locationId }]
      },
      include: {
        slots: { include: { musicMode: { select: { id: true, name: true, slug: true, status: true } } } }
      }
    });
    const resolution = resolveMusicSchedule({
      schedules,
      instant,
      timezone: zone.location.timezone,
      locationOpen: opening.isOpen
    });
    return NextResponse.json({
      zone: { id: zone.id, name: zone.name },
      location: { id: zone.location.id, name: zone.location.name, timezone: zone.location.timezone },
      opening,
      resolution
    });
  } catch (error) {
    console.error("Resolve music schedule error:", error);
    return NextResponse.json({ error: "Unable to resolve the music schedule." }, { status: 500 });
  }
}
