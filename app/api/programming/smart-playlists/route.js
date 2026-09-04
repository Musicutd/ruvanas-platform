import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import {
  canAuthorSmartPlaylist,
  canPublishSmartPlaylist,
  parseSmartPlaylistInput,
  smartPlaylistSlug
} from "@/lib/smart-playlists.mjs";
import { listSmartPlaylists, safeSmartPlaylist } from "@/lib/smart-playlist-service";

export const dynamic = "force-dynamic";

async function contextForSmartPlaylists() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (!context.membership) return { response: NextResponse.json({ error: "No active organisation is available." }, { status: 403 }) };
  if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
    return { response: NextResponse.json({ error: "Smart Playlists are unavailable while this service is inactive." }, { status: 403 }) };
  }
  return { context };
}

export async function GET() {
  try {
    const access = await contextForSmartPlaylists();
    if (access.response) return access.response;
    const { membership } = access.context;
    return NextResponse.json({
      ok: true,
      canAuthor: canAuthorSmartPlaylist(membership.role),
      canPublish: canPublishSmartPlaylist(membership.role),
      playlists: await listSmartPlaylists(membership.organisationId)
    });
  } catch (error) {
    console.error("Smart playlist list error:", error);
    return NextResponse.json({ error: "Unable to load Smart Playlists." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForSmartPlaylists();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canAuthorSmartPlaylist(membership.role)) {
      return NextResponse.json({ error: "Only owners, managers and content editors can build Smart Playlists." }, { status: 403 });
    }
    const parsed = parseSmartPlaylistInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const organisationId = membership.organisationId;
    const slug = `${smartPlaylistSlug(parsed.data.name)}-smart`;

    const created = await prisma.$transaction(async (tx) => {
      const mode = await tx.musicMode.create({
        data: {
          organisationId,
          name: parsed.data.name,
          slug,
          description: parsed.data.description,
          source: "SMART_PLAYLIST",
          status: "DRAFT"
        }
      });
      const playlist = await tx.smartPlaylist.create({
        data: {
          organisationId,
          musicModeId: mode.id,
          maxTracks: parsed.data.maxTracks,
          defaultWeight: parsed.data.defaultWeight,
          sort: parsed.data.sort,
          rightsUse: parsed.data.rightsUse,
          territory: parsed.data.territory,
          createdByUserId: user.id,
          rules: {
            create: parsed.data.rules.map((rule, position) => ({ ...rule, position }))
          }
        },
        include: {
          musicMode: { select: { id: true, name: true, slug: true, description: true, status: true, source: true } },
          rules: { orderBy: { position: "asc" } },
          createdBy: { select: { id: true, name: true } },
          publishedBy: { select: { id: true, name: true } }
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: user.id,
          action: "SMART_PLAYLIST_DRAFT_CREATED",
          entityType: "SmartPlaylist",
          entityId: playlist.id,
          details: { musicModeId: mode.id, ruleCount: parsed.data.rules.length, rightsUse: parsed.data.rightsUse }
        }
      });
      return playlist;
    });
    return NextResponse.json({ ok: true, playlist: safeSmartPlaylist(created) }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "A music mode or Smart Playlist already uses this name." }, { status: 409 });
    console.error("Smart playlist create error:", error);
    return NextResponse.json({ error: "Unable to create the Smart Playlist." }, { status: 500 });
  }
}
