import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { previewSmartPlaylist } from "@/lib/smart-playlist-service";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
      return NextResponse.json({ error: "Smart Playlists are unavailable while this service is inactive." }, { status: 403 });
    }
    const preview = await previewSmartPlaylist({
      organisationId: context.membership.organisationId,
      smartPlaylistId: params.smartPlaylistId
    });
    if (!preview) return NextResponse.json({ error: "Smart Playlist not found." }, { status: 404 });
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    console.error("Smart playlist preview error:", error);
    return NextResponse.json({ error: "Unable to preview the Smart Playlist." }, { status: 500 });
  }
}
