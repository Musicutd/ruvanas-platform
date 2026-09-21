import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveStudio } from "@/lib/studio-access";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { loadEligibleSubscriberMusic, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";
import { filterStudioLibraryCards, studioLibraryCard, STUDIO_LIBRARY_PAGE_SIZE } from "@/lib/studio-library-browser.mjs";

export const dynamic = "force-dynamic";

const useByProduct = Object.freeze({ RETAIL: "RETAIL_RADIO", SCHOOL: "SCHOOL_RADIO", ONLINE: "ONLINE_RADIO", HEALTH: "HEALTH_RADIO", FAITH: "FAITH_RADIO", ORGANISATIONS: "ORGANISATIONS_RADIO" });

export async function GET(request) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const params = new URL(request.url).searchParams;
    const requestedChannelId = params.get("channelId") || "";
    const query = (params.get("q") || "").slice(0, 100);
    const genre = (params.get("genre") || "").slice(0, 60);
    const page = Math.min(100, Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1));
    const channels = await prisma.channel.findMany({
      where: { organisationId: access.organisation.id, status: "ACTIVE" },
      select: { id: true, name: true, musicRightsUse: true, station: { select: { productFamily: true } }, autoDjPolicy: { select: { territory: true } } },
      orderBy: { name: "asc" }
    });
    const channel = requestedChannelId ? channels.find((item) => item.id === requestedChannelId) : channels[0];
    if (requestedChannelId && !channel) return NextResponse.json({ error: "Choose a channel belonging to your organisation." }, { status: 404 });
    const rightsUse = channel ? rightsUseForChannel(channel) : useByProduct[access.entitlements.planProductFamily];
    if (!rightsUse) return NextResponse.json({ error: "A music-rights product is needed before browsing this library." }, { status: 409 });
    const territory = channel?.autoDjPolicy?.territory || null;
    const configuredGenres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true, active: true, minimumCatalogueLevel: true } });
    const entries = await loadEligibleSubscriberMusic(prisma, {
      organisationId: access.organisation.id,
      requiredUse: rightsUse,
      territory,
      catalogueLevel: access.entitlements.licensedMusicCatalogueLevel,
      configuredGenres
    });
    // Only metadata is returned. Never expose source URLs, storage keys or media asset IDs.
    const allCards = entries.map(studioLibraryCard);
    const genres = [...new Set(allCards.flatMap((card) => card.genres))].sort((left, right) => left.localeCompare(right));
    const filtered = filterStudioLibraryCards(allCards, { query, genre });
    const tracks = filtered.slice((page - 1) * STUDIO_LIBRARY_PAGE_SIZE, page * STUDIO_LIBRARY_PAGE_SIZE);
    return NextResponse.json({
      tracks,
      total: filtered.length,
      page,
      pageSize: STUDIO_LIBRARY_PAGE_SIZE,
      channels: channels.map((item) => ({ id: item.id, name: item.name })),
      genres,
      selectedChannelId: channel?.id || null,
      territoryKnown: Boolean(territory)
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Studio library metadata load failed:", error);
    return NextResponse.json({ error: "The Studio library could not be loaded." }, { status: 500 });
  }
}
