import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  isValidIanaTimezone,
  normaliseOpeningHoursPayload
} from "@/lib/opening-hours.mjs";

export async function PUT(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);

    const location = await prisma.location.findUnique({
      where: { id: params.locationId },
      select: { id: true, organisationId: true, timezone: true }
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }
    if (!isValidIanaTimezone(location.timezone)) {
      return NextResponse.json(
        { error: "This location needs a valid IANA timezone before opening hours can be saved." },
        { status: 400 }
      );
    }

    let schedule;
    try {
      schedule = normaliseOpeningHoursPayload(await request.json());
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.locationOpeningHour.deleteMany({ where: { locationId: location.id } });
      await tx.locationOpeningException.deleteMany({ where: { locationId: location.id } });

      await tx.locationOpeningHour.createMany({
        data: schedule.weeklyHours.map((entry) => ({ locationId: location.id, ...entry }))
      });
      if (schedule.exceptions.length) {
        await tx.locationOpeningException.createMany({
          data: schedule.exceptions.map((entry) => ({
            locationId: location.id,
            date: new Date(`${entry.date}T00:00:00.000Z`),
            label: entry.label,
            isClosed: entry.isClosed,
            opensAtMinute: entry.opensAtMinute,
            closesAtMinute: entry.closesAtMinute
          }))
        });
      }

      await tx.auditLog.create({
        data: {
          organisationId: location.organisationId,
          actorUserId: access.user.id,
          action: "LOCATION_OPENING_HOURS_UPDATED",
          entityType: "Location",
          entityId: location.id,
          details: {
            timezone: location.timezone,
            weeklyHours: schedule.weeklyHours,
            exceptionCount: schedule.exceptions.length,
            exceptionDates: schedule.exceptions.map((entry) => entry.date)
          }
        }
      });
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("LOCATION_OPENING_HOURS_UPDATE_ERROR", error);
    return NextResponse.json(
      { error: "Unable to save opening hours. Please try again." },
      { status: 500 }
    );
  }
}
