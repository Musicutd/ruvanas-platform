import { NextResponse } from "next/server";
import { contextForAutoDjExpansion } from "@/lib/autodj-expansion-access";
import { regenerateGeneratedDraft, safeGeneratedPlaylist } from "@/lib/generated-playlist-service";

export async function POST(request, { params }) {
  try {
    const access = await contextForAutoDjExpansion();
    if (access.response) return access.response;
    if (!access.canAuthor) return NextResponse.json({ error: "Only owners, managers and content editors can regenerate timed playlists." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (body.action !== "REGENERATE") return NextResponse.json({ error: "Choose a supported playlist action." }, { status: 400 });
    const playlist = await regenerateGeneratedDraft({ organisationId: access.context.membership.organisationId, playlistId: params.playlistId, actorUserId: access.context.user.id, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel });
    if (!playlist) return NextResponse.json({ error: "Timed playlist not found." }, { status: 404 });
    return NextResponse.json({ ok: true, playlist: safeGeneratedPlaylist(playlist) });
  } catch (error) {
    console.error("Timed playlist regeneration error:", error);
    return NextResponse.json({ error: "Unable to regenerate the timed playlist." }, { status: 500 });
  }
}
