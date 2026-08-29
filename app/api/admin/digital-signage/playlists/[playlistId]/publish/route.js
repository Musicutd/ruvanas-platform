import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied } from "@/lib/api-response";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { requireDigitalSignageOrganisation } from "@/lib/digital-signage-access";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(request, { params }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    const playlistId = String(params.playlistId || "");
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "PUBLISH").toUpperCase();
    if (!new Set(["PUBLISH", "PAUSE"]).has(action)) return NextResponse.json({ error: "Choose publish or pause." }, { status: 400 });
    const playlist = await prisma.digitalSignagePlaylist.findUnique({
      where: { id: playlistId },
      include: {
        layout: { select: { status: true } },
        items: { include: { asset: { select: { status: true, kind: true } } } },
        devices: { include: { device: { select: { status: true } } } }
      }
    });
    if (!playlist) return NextResponse.json({ error: "Visual playlist not found." }, { status: 404 });
    const access = await requireDigitalSignageOrganisation(playlist.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    if (action === "PUBLISH" && (!playlist.items.length || !playlist.devices.length)) return NextResponse.json({ error: "A published playlist needs visual items and at least one assigned device." }, { status: 400 });
    if (action === "PUBLISH" && playlist.layout.status === "ARCHIVED") return NextResponse.json({ error: "An archived layout cannot be published." }, { status: 400 });
    if (action === "PUBLISH" && playlist.items.some((item) => item.asset.status !== "READY" || item.asset.kind !== "IMAGE")) return NextResponse.json({ error: "Every visual must still be an approved, ready image before publishing." }, { status: 400 });
    if (action === "PUBLISH" && playlist.devices.some((assignment) => assignment.device.status === "DISABLED")) return NextResponse.json({ error: "Remove disabled displays before publishing this playlist." }, { status: 400 });

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.digitalSignagePlaylist.update({
        where: { id: playlist.id },
        data: action === "PUBLISH"
          ? { status: "PUBLISHED", version: { increment: 1 }, publishedAt: now, publishedByUserId: access.user.id }
          : { status: "PAUSED" }
      });
      if (action === "PUBLISH") await tx.digitalSignageLayout.updateMany({ where: { id: playlist.layoutId, organisationId: playlist.organisationId, status: "DRAFT" }, data: { status: "ACTIVE" } });
      await tx.auditLog.create({ data: {
        organisationId: playlist.organisationId,
        actorUserId: access.user.id,
        action: action === "PUBLISH" ? "DIGITAL_SIGNAGE_PLAYLIST_PUBLISHED" : "DIGITAL_SIGNAGE_PLAYLIST_PAUSED",
        entityType: "DigitalSignagePlaylist",
        entityId: playlist.id,
        details: { name: playlist.name, previousStatus: playlist.status, status: value.status, version: value.version }
      } });
      return value;
    });
    return NextResponse.json({ playlist: updated });
  } catch (error) {
    console.error("Update digital signage playlist error:", error);
    return NextResponse.json({ error: "Unable to update the visual playlist." }, { status: 500 });
  }
}
