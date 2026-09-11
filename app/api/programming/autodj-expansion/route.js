import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForAutoDjExpansion } from "@/lib/autodj-expansion-access";
import { CANONICAL_AUTODJ_GENRES, assertGenreSelection, licensedGenresForLevel } from "@/lib/autodj-genre-entitlements.mjs";
import { listAutoDjTargets, resolveAutoDjTarget } from "@/lib/autodj-targets";
import { parseTimedPlaylistInput, invalidationForCatalogueDowngrade } from "@/lib/timed-playlist-generator.mjs";
import { createGeneratedDraft, generatedPlaylistInclude, safeGeneratedPlaylist } from "@/lib/generated-playlist-service";

export const dynamic = "force-dynamic";

async function configuredGenres() {
  return prisma.mediaGenre.findMany({ where: { active: true }, select: { id: true, name: true, slug: true, active: true, minimumCatalogueLevel: true }, orderBy: { name: "asc" }, take: 250 });
}

export async function GET() {
  try {
    const access = await contextForAutoDjExpansion();
    if (access.response) return access.response;
    const { membership } = access.context;
    const [genres, targets, playlists] = await Promise.all([
      configuredGenres(),
      listAutoDjTargets(membership.organisationId, access.entitlements),
      prisma.generatedPlaylist.findMany({ where: { organisationId: membership.organisationId, status: { not: "ARCHIVED" } }, include: generatedPlaylistInclude, orderBy: { updatedAt: "desc" }, take: 100 })
    ]);
    const today = new Date().toISOString().slice(0, 10);
    for (const playlist of playlists) {
      if (playlist.scheduledDate.toISOString().slice(0, 10) < today) continue;
      const invalidReason = invalidationForCatalogueDowngrade(playlist, access.entitlements.licensedMusicCatalogueLevel, genres);
      if (invalidReason && playlist.invalidReason !== invalidReason) {
        await prisma.generatedPlaylist.update({ where: { id: playlist.id }, data: { status: "INVALIDATED", invalidReason } });
        playlist.status = "INVALIDATED"; playlist.invalidReason = invalidReason;
      }
    }
    const licensed = licensedGenresForLevel(access.entitlements.licensedMusicCatalogueLevel, genres);
    const availableCodes = new Set(licensed.map((genre) => genre.code));
    return NextResponse.json({
      ok: true, canAuthor: access.canAuthor, canPublish: access.canPublish,
      catalogueLevel: access.entitlements.licensedMusicCatalogueLevel,
      sourceScopes: [
        { code: "SUBSCRIBER_LIBRARY", label: "My rights-cleared library", enabled: true },
        { code: "RUVANAS_CORE", label: "Ruvanas core catalogue", enabled: access.entitlements.includesRuvanasCatalogue },
        { code: "LICENSED_CATALOGUE", label: "Licensed Music Catalogue", enabled: access.entitlements.licensedMusicCatalogueEnabled }
      ],
      genres: [...CANONICAL_AUTODJ_GENRES.map((genre) => ({ code: genre.code, label: genre.label, enabled: availableCodes.has(genre.code), minimumLevel: genre.minimumLevel, premiumMore: false })), ...licensed.filter((genre) => genre.premiumMore)],
      targets, playlists: playlists.map(safeGeneratedPlaylist)
    });
  } catch (error) {
    console.error("AutoDJ expansion list error:", error);
    return NextResponse.json({ error: "Unable to load the AutoDJ workspace." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForAutoDjExpansion();
    if (access.response) return access.response;
    if (!access.canAuthor) return NextResponse.json({ error: "Only owners, managers and content editors can generate timed playlists." }, { status: 403 });
    const body = await request.json().catch(() => null);
    const target = await resolveAutoDjTarget(access.context.membership.organisationId, body?.targetType, body?.targetId, access.entitlements);
    const parsed = parseTimedPlaylistInput(body, target);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const genres = await configuredGenres();
    let selection;
    try { selection = assertGenreSelection({ selectedGenreCodes: parsed.data.selectedGenreCodes, sourceScopes: parsed.data.sourceScopes, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel, configuredGenres: genres }); }
    catch (error) { return NextResponse.json({ error: error.message, code: error.code || "INVALID_GENRE_SELECTION" }, { status: 403 }); }
    const playlist = await createGeneratedDraft({ organisationId: access.context.membership.organisationId, actorUserId: access.context.user.id, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel, input: { ...parsed.data, ...selection, territory: parsed.data.territory || target.territory } });
    return NextResponse.json({ ok: true, playlist: safeGeneratedPlaylist(playlist) }, { status: 201 });
  } catch (error) {
    console.error("Timed playlist generation error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate the timed playlist." }, { status: error?.code === "TARGET_NOT_ALLOWED" ? 403 : 500 });
  }
}
