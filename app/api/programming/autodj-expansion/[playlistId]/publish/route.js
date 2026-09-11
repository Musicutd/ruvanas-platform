import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForAutoDjExpansion } from "@/lib/autodj-expansion-access";
import { assertGenreSelection } from "@/lib/autodj-genre-entitlements.mjs";
import { publishGeneratedPlaylist, safeGeneratedPlaylist } from "@/lib/generated-playlist-service";

export async function POST(_request, { params }) {
  try {
    const access = await contextForAutoDjExpansion();
    if (access.response) return access.response;
    if (!access.canPublish) return NextResponse.json({ error: "Only organisation owners and managers can publish timed playlists." }, { status: 403 });
    const current = await prisma.generatedPlaylist.findFirst({ where: { id: params.playlistId, organisationId: access.context.membership.organisationId } });
    if (!current) return NextResponse.json({ error: "Timed playlist not found." }, { status: 404 });
    const genres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 250 });
    try { assertGenreSelection({ selectedGenreCodes: current.selectedGenreCodes, sourceScopes: current.sourceScopes, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel, configuredGenres: genres }); }
    catch (error) { return NextResponse.json({ error: error.message, code: error.code || "GENERATION_INVALIDATED" }, { status: 403 }); }
    const playlist = await publishGeneratedPlaylist({ organisationId: access.context.membership.organisationId, playlistId: current.id, actorUserId: access.context.user.id, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel, configuredGenres: genres });
    return NextResponse.json({ ok: true, playlist: safeGeneratedPlaylist(playlist) });
  } catch (error) {
    const status = ["EMPTY_GENERATION", "GENERATION_INVALIDATED"].includes(error?.code) ? 409 : 500;
    console.error("Timed playlist publish error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to publish the timed playlist." }, { status });
  }
}
