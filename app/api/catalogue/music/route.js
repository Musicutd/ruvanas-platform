import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { loadEligibleSubscriberMusic, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";
import { normaliseGenreCode } from "@/lib/autodj-genre-entitlements.mjs";

export const dynamic = "force-dynamic";

const useByProduct = { RETAIL: "RETAIL_RADIO", SCHOOL: "SCHOOL_RADIO", ONLINE: "ONLINE_RADIO", HEALTH: "HEALTH_RADIO", FAITH: "FAITH_RADIO", ORGANISATIONS: "ORGANISATIONS_RADIO" };

export async function GET(request) {
  const access = await simplePlaylistAccess();
  if (access.response) return access.response;
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const query = (searchParams.get("q") || "").trim().toLowerCase().slice(0, 100);
  const genre = normaliseGenreCode(searchParams.get("genre") || "");
  const limit = Math.min(50, Math.max(1, Number.parseInt(searchParams.get("limit") || "30", 10) || 30));
  const organisationId = access.context.membership.organisationId;
  let rightsUse = useByProduct[access.entitlements.planProductFamily] || null;
  let territory = null;
  if (channelId) {
    const channel = await prisma.channel.findFirst({ where: { id: channelId, organisationId }, include: { station: { select: { productFamily: true } }, autoDjPolicy: { select: { territory: true } } } });
    if (!channel) return NextResponse.json({ error: "Choose a channel owned by your organisation." }, { status: 404 });
    rightsUse = rightsUseForChannel(channel);
    territory = channel.autoDjPolicy?.territory || null;
  }
  if (!rightsUse) return NextResponse.json({ error: "This product needs a music-rights profile." }, { status: 409 });
  const configuredGenres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true, active: true, minimumCatalogueLevel: true } });
  const entries = await loadEligibleSubscriberMusic(prisma, {
    organisationId, requiredUse: rightsUse, territory,
    catalogueLevel: access.entitlements.licensedMusicCatalogueLevel,
    configuredGenres, sourceScopes: ["LICENSED_CATALOGUE"]
  });
  const filtered = entries.filter(({ track, genreCodes }) =>
    (!genre || genreCodes.includes(genre)) &&
    (!query || `${track.artist} ${track.title} ${track.album || ""} ${track.mixName || ""}`.toLowerCase().includes(query))
  );
  // Explicit allow-list. Never serialize provider responses, credentials, media keys or source URLs.
  const tracks = filtered.slice(0, limit).map(({ track, genreCodes }) => ({
    id: track.id, title: track.title, artist: track.artist, album: track.album,
    mix: track.mixName, bpm: track.bpm, durationSeconds: track.mediaAsset.durationSeconds,
    genreCodes, explicit: track.isExplicit, catalogueTier: track.minimumCatalogueLevel
  }));
  return NextResponse.json({ tracks, total: filtered.length, limit, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel });
}
