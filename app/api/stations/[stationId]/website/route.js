import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { normalizeStationWebsiteSettings } from "@/lib/station-website.mjs";

export async function PATCH(request, { params }) {
  try {
    const station = await prisma.station.findUnique({ where: { id: String(params.stationId || "") }, select: { id: true, organisationId: true, status: true, publicPlayerEnabled: true, slug: true } });
    if (!station) return NextResponse.json({ error: "Station not found." }, { status: 404 });
    const access = await requireOrganisationAccess(station.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const text = await request.text();
    if (text.length > 16_384) return NextResponse.json({ error: "The station website settings are too large." }, { status: 413 });
    let body;
    try { body = JSON.parse(text); }
    catch { return NextResponse.json({ error: "Send valid station website settings." }, { status: 400 }); }
    const settings = normalizeStationWebsiteSettings(body);
    if (settings.enabled && station.status !== "ACTIVE") return NextResponse.json({ error: "Activate the station before publishing its website." }, { status: 409 });
    if (settings.enabled && !station.publicPlayerEnabled) return NextResponse.json({ error: "Publish the station’s public player before publishing its website." }, { status: 409 });
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.station.update({
        where: { id: station.id },
        data: {
          stationWebsiteEnabled: settings.enabled,
          stationWebsiteHeadline: settings.headline,
          stationWebsiteAbout: settings.about,
          stationWebsiteHeroImageUrl: settings.heroImageUrl,
          stationWebsiteContactEmail: settings.contactEmail,
          stationWebsiteTheme: settings.theme,
          stationWebsiteLinks: settings.links,
          stationWebsiteShowNowPlaying: settings.showNowPlaying,
          stationWebsiteShowPodcasts: settings.showPodcasts
        },
        select: { id: true, slug: true, stationWebsiteEnabled: true, stationWebsiteTheme: true }
      });
      if (!settings.enabled) await tx.stationDomain.updateMany({ where: { stationId: station.id, status: "ACTIVE" }, data: { status: "VERIFIED", activatedAt: null } });
      await tx.auditLog.create({ data: {
        organisationId: station.organisationId,
        actorUserId: access.user.id,
        action: settings.enabled ? "STATION_WEBSITE_PUBLISHED" : "STATION_WEBSITE_UNPUBLISHED",
        entityType: "Station",
        entityId: station.id,
        details: { theme: settings.theme, contactConfigured: Boolean(settings.contactEmail), linkCount: settings.links.length, showNowPlaying: settings.showNowPlaying, showPodcasts: settings.showPodcasts }
      } });
      return value;
    });
    return NextResponse.json({ success: true, website: { enabled: updated.stationWebsiteEnabled, theme: updated.stationWebsiteTheme, url: `/radio/${updated.slug}` } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the station website.";
    if (/website|headline|hero|contact|link|theme|HTTPS|address/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    console.error("Station website settings failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "Unable to update the station website." }, { status: 500 });
  }
}
