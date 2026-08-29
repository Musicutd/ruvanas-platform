import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied } from "@/lib/api-response";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { requireDigitalSignageOrganisation } from "@/lib/digital-signage-access";
import { normaliseDigitalSignageTakeover } from "@/lib/digital-signage-delivery.mjs";

export const dynamic = "force-dynamic";

const include = {
  playlist: { select: { id: true, name: true, status: true, version: true } },
  devices: { include: { device: { select: { id: true, name: true, status: true, zone: { select: { name: true, location: { select: { name: true } } } } } } } },
  createdBy: { select: { id: true, name: true, email: true } },
  activatedBy: { select: { id: true, name: true, email: true } },
  endedBy: { select: { id: true, name: true, email: true } }
};

export async function GET(request) {
  try {
    const organisationId = new URL(request.url).searchParams.get("organisationId") || "";
    const access = await requireDigitalSignageOrganisation(organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const takeovers = await prisma.digitalSignageTakeover.findMany({ where: { organisationId }, include, orderBy: { createdAt: "desc" }, take: 100 });
    return NextResponse.json({ takeovers, safetyNotice: "Visual takeovers supplement operational communication and are not a certified life-safety alarm system." });
  } catch (error) {
    console.error("List signage takeovers error:", error);
    return NextResponse.json({ error: "Unable to load visual takeovers." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    let input;
    try { input = normaliseDigitalSignageTakeover(await request.json()); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid visual takeover." }, { status: 400 }); }
    const access = await requireDigitalSignageOrganisation(input.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    const [playlist, devices] = await Promise.all([
      prisma.digitalSignagePlaylist.findFirst({ where: { id: input.playlistId, organisationId: input.organisationId, status: "PUBLISHED" }, include: { items: { include: { asset: { select: { status: true } } } } } }),
      prisma.digitalSignageDevice.findMany({ where: { id: { in: input.deviceIds }, organisationId: input.organisationId, status: { not: "DISABLED" } } })
    ]);
    if (!playlist || !playlist.items.length || playlist.items.some((item) => item.asset.status !== "READY")) return NextResponse.json({ error: "Choose a published playlist whose visuals are all ready." }, { status: 400 });
    if (devices.length !== input.deviceIds.length) return NextResponse.json({ error: "Every takeover display must be active and belong to this organisation." }, { status: 400 });
    const takeover = await prisma.$transaction(async (tx) => {
      const created = await tx.digitalSignageTakeover.create({ data: {
        organisationId: input.organisationId,
        playlistId: input.playlistId,
        name: input.name,
        reason: input.reason,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdByUserId: access.user.id,
        devices: { create: input.deviceIds.map((deviceId) => ({ deviceId })) }
      }, include });
      await tx.auditLog.create({ data: { organisationId: input.organisationId, actorUserId: access.user.id, action: "DIGITAL_SIGNAGE_TAKEOVER_DRAFTED", entityType: "DigitalSignageTakeover", entityId: created.id, details: { playlistId: input.playlistId, deviceIds: input.deviceIds, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason } } });
      return created;
    });
    return NextResponse.json({ takeover }, { status: 201 });
  } catch (error) {
    console.error("Create signage takeover error:", error);
    return NextResponse.json({ error: "Unable to create the visual takeover." }, { status: 500 });
  }
}
