import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canPublishSmartPlaylist } from "@/lib/smart-playlists.mjs";
import { archiveSmartPlaylist } from "@/lib/smart-playlist-service";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
      return NextResponse.json({ error: "Smart Playlists are unavailable while this service is inactive." }, { status: 403 });
    }
    if (!canPublishSmartPlaylist(context.membership.role)) {
      return NextResponse.json({ error: "Only organisation owners and managers can archive Smart Playlists." }, { status: 403 });
    }
    const playlist = await archiveSmartPlaylist({
      organisationId: context.membership.organisationId,
      smartPlaylistId: params.smartPlaylistId,
      actorUserId: context.user.id
    });
    if (!playlist) return NextResponse.json({ error: "Smart Playlist not found." }, { status: 404 });
    return NextResponse.json({ ok: true, playlist });
  } catch (error) {
    console.error("Smart playlist archive error:", error);
    return NextResponse.json({ error: "Unable to archive the Smart Playlist." }, { status: 500 });
  }
}
