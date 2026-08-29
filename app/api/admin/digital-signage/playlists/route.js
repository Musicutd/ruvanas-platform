import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied } from "@/lib/api-response";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { requireDigitalSignageOrganisation } from "@/lib/digital-signage-access";
import { normaliseDigitalSignagePlaylist } from "@/lib/digital-signage-delivery.mjs";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const playlistInclude = {
  layout: { include: { regions: { orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }] } } },
  items: { include: { asset: { select: { id: true, name: true, status: true, kind: true, width: true, height: true } }, region: { select: { id: true, name: true } } }, orderBy: [{ regionId: "asc" }, { position: "asc" }] },
  devices: { include: { device: { select: { id: true, name: true, status: true } } } }
};

export async function GET(request) {
  try {
    const organisationId = new URL(request.url).searchParams.get("organisationId") || "";
    const access = await requireDigitalSignageOrganisation(organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);
    const playlists = await prisma.digitalSignagePlaylist.findMany({
      where: { organisationId, status: { not: "ARCHIVED" } },
      include: playlistInclude,
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }]
    });
    return NextResponse.json({ playlists });
  } catch (error) {
    console.error("List digital signage playlists error:", error);
    return NextResponse.json({ error: "Unable to load visual playlists." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    let input;
    try { input = normaliseDigitalSignagePlaylist(await request.json()); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid visual playlist." }, { status: 400 }); }
    const access = await requireDigitalSignageOrganisation(input.organisationId, ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return accessDenied(access);

    const [layout, assets, devices] = await Promise.all([
      prisma.digitalSignageLayout.findFirst({ where: { id: input.layoutId, organisationId: input.organisationId }, include: { regions: true } }),
      prisma.digitalSignageAsset.findMany({ where: { id: { in: [...new Set(input.items.map((item) => item.assetId))] }, organisationId: input.organisationId, status: "READY", kind: { in: ["IMAGE", "VIDEO"] } } }),
      prisma.digitalSignageDevice.findMany({ where: { id: { in: input.deviceIds }, organisationId: input.organisationId } })
    ]);
    if (!layout) return NextResponse.json({ error: "The selected layout does not belong to this organisation." }, { status: 400 });
    const regionIds = new Set(layout.regions.map((region) => region.id));
    if (input.items.some((item) => !regionIds.has(item.regionId))) return NextResponse.json({ error: "Every playlist region must belong to the selected layout." }, { status: 400 });
    if (assets.length !== new Set(input.items.map((item) => item.assetId)).size) return NextResponse.json({ error: "Every visual item must be a ready image or normalized video owned by this organisation." }, { status: 400 });
    if (devices.length !== input.deviceIds.length) return NextResponse.json({ error: "Every assigned device must belong to this organisation." }, { status: 400 });

    const playlist = await prisma.$transaction(async (tx) => {
      const created = await tx.digitalSignagePlaylist.create({ data: {
        organisationId: input.organisationId,
        layoutId: input.layoutId,
        name: input.name,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        activeDays: input.activeDays,
        dailyStartMinute: input.dailyStartMinute,
        dailyEndMinute: input.dailyEndMinute,
        priority: input.priority,
        createdByUserId: access.user.id,
        items: { create: input.items },
        devices: { create: input.deviceIds.map((deviceId) => ({ deviceId })) }
      }, include: playlistInclude });
      await tx.auditLog.create({ data: {
        organisationId: input.organisationId,
        actorUserId: access.user.id,
        action: "DIGITAL_SIGNAGE_PLAYLIST_CREATED",
        entityType: "DigitalSignagePlaylist",
        entityId: created.id,
        details: { name: created.name, layoutId: created.layoutId, itemCount: created.items.length, deviceCount: created.devices.length, activeDays: created.activeDays, dailyStartMinute: created.dailyStartMinute, dailyEndMinute: created.dailyEndMinute, priority: created.priority }
      } });
      return created;
    });
    return NextResponse.json({ playlist }, { status: 201 });
  } catch (error) {
    console.error("Create digital signage playlist error:", error);
    const status = error?.code === "P2002" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? "A visual playlist with this name already exists." : "Unable to create the visual playlist." }, { status });
  }
}
