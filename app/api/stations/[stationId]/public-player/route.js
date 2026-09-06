import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { normalizePublicPlayerSettings } from "@/lib/public-player.mjs";

export async function PATCH(request, { params }) {
  try {
    const station = await prisma.station.findUnique({ where: { id: String(params.stationId || "") }, select: { id: true, organisationId: true, status: true, slug: true } });
    if (!station) return NextResponse.json({ error: "Station not found." }, { status: 404 });
    const access = await requireOrganisationAccess(station.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const text = await request.text();
    if (text.length > 4_096) return NextResponse.json({ error: "The public-player settings are too large." }, { status: 413 });
    let body;
    try { body = JSON.parse(text); }
    catch { return NextResponse.json({ error: "Send valid public-player settings." }, { status: 400 }); }
    const settings = normalizePublicPlayerSettings(body);
    if (settings.enabled) {
      if (station.status !== "ACTIVE") return NextResponse.json({ error: "Activate the station before publishing its player." }, { status: 409 });
      const channel = await prisma.channel.findFirst({ where: { organisationId: station.organisationId, stationId: station.id, status: "ACTIVE", zoneAssignments: { some: { OR: [{ activeTo: null }, { activeTo: { gt: new Date() } }] } } }, select: { id: true } });
      if (!channel) return NextResponse.json({ error: "Assign an active channel to a listening zone before publishing the player." }, { status: 409 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.station.update({ where: { id: station.id }, data: { publicPlayerEnabled: settings.enabled, publicPlayerTagline: settings.tagline, publicPlayerAccent: settings.accent }, select: { id: true, slug: true, publicPlayerEnabled: true, publicPlayerTagline: true, publicPlayerAccent: true } });
      await tx.auditLog.create({ data: { organisationId: station.organisationId, actorUserId: access.user.id, action: settings.enabled ? "PUBLIC_PLAYER_PUBLISHED" : "PUBLIC_PLAYER_UNPUBLISHED", entityType: "Station", entityId: station.id, details: { taglineConfigured: Boolean(settings.tagline), accent: settings.accent } } });
      return value;
    });
    return NextResponse.json({ success: true, player: { enabled: updated.publicPlayerEnabled, tagline: updated.publicPlayerTagline, accent: updated.publicPlayerAccent, listenUrl: `/listen/${updated.slug}`, embedUrl: `/embed/${updated.slug}` } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the public player.";
    if (/tagline|accent colour/.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    console.error("Public player settings failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "Unable to update the public player." }, { status: 500 });
  }
}
