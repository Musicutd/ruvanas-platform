import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied } from "@/lib/api-response";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { requireDigitalSignageOrganisation } from "@/lib/digital-signage-access";
import { normaliseDigitalSignageDevice } from "@/lib/digital-signage.mjs";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { playerTokenHash } from "@/lib/player-auth";
import { getCurrentUser } from "@/lib/auth";

const ENROLMENT_HOURS = 24;

export async function GET(request) {
  try {
    const organisationId = new URL(request.url).searchParams.get("organisationId") || "";
    const access = await requireDigitalSignageOrganisation(organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    const devices = await prisma.digitalSignageDevice.findMany({
      where: { organisationId },
      include: { zone: { include: { location: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "desc" }
    });
    return NextResponse.json({ devices: devices.map(({ enrolmentTokenHash, sessionTokenHash, ...device }) => device) });
  } catch (error) {
    console.error("List digital signage devices error:", error);
    return NextResponse.json({ error: "Unable to load signage devices." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    let input;
    try { input = normaliseDigitalSignageDevice(await request.json()); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid device." }, { status: 400 }); }
    const access = await requireDigitalSignageOrganisation(input.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);

    const zone = await prisma.zone.findFirst({ where: { id: input.zoneId, location: { organisationId: input.organisationId } }, include: { location: true } });
    if (!zone) return NextResponse.json({ error: "The selected zone does not belong to this organisation." }, { status: 400 });

    const enrolmentCode = createPlayerToken();
    const enrolmentExpiresAt = new Date(Date.now() + ENROLMENT_HOURS * 60 * 60 * 1000);
    const device = await prisma.$transaction(async (tx) => {
      const created = await tx.digitalSignageDevice.create({ data: {
        ...input,
        createdByUserId: access.user.id,
        enrolmentTokenHash: playerTokenHash(enrolmentCode),
        enrolmentExpiresAt
      } });
      await tx.auditLog.create({ data: {
        organisationId: input.organisationId,
        actorUserId: access.user.id,
        action: "DIGITAL_SIGNAGE_DEVICE_CREATED",
        entityType: "DigitalSignageDevice",
        entityId: created.id,
        details: { name: created.name, zoneId: created.zoneId, locationId: zone.locationId, orientation: created.orientation, viewportWidth: created.viewportWidth, viewportHeight: created.viewportHeight, enrolmentExpiresAt }
      } });
      return created;
    });
    return NextResponse.json({ device: { id: device.id, name: device.name, enrolmentCode, enrolmentExpiresAt, status: device.status } }, { status: 201 });
  } catch (error) {
    console.error("Create digital signage device error:", error);
    return NextResponse.json({ error: "Unable to create the signage device." }, { status: 500 });
  }
}
