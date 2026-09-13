import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied } from "@/lib/api-response";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { requireDigitalSignageOrganisation } from "@/lib/digital-signage-access";
import { normaliseDigitalSignageDevice } from "@/lib/digital-signage.mjs";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { playerTokenHash } from "@/lib/player-auth";
import { getCurrentUser } from "@/lib/auth";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

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
    return NextResponse.json({
      devices: devices.map(({ enrolmentTokenHash, sessionTokenHash, ...device }) => device),
      displayLimit: access.entitlements.digitalSignageDisplayLimit
    });
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
    const device = await runSerializableTransaction(prisma, async (tx) => {
      const displayLimit = access.entitlements.digitalSignageDisplayLimit;
      if (Number.isInteger(displayLimit) && displayLimit > 0) {
        const activeDisplayCount = await tx.digitalSignageDevice.count({
          where: { organisationId: input.organisationId, status: { not: "DISABLED" } }
        });
        if (activeDisplayCount >= displayLimit) {
          throw Object.assign(new Error(`Your Retail plan supports ${displayLimit} connected digital display${displayLimit === 1 ? "" : "s"}. Disable an existing display or change plan before adding another.`), { status: 403 });
        }
      }
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
    const status = error?.status === 403 ? 403 : 500;
    return NextResponse.json({ error: status === 403 ? error.message : "Unable to create the signage device." }, { status });
  }
}
