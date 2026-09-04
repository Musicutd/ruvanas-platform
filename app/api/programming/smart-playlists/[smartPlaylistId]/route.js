import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canAuthorSmartPlaylist, parseSmartPlaylistInput, smartPlaylistSlug } from "@/lib/smart-playlists.mjs";
import { safeSmartPlaylist } from "@/lib/smart-playlist-service";

export const dynamic = "force-dynamic";

export async function PUT(request, { params }) {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
      return NextResponse.json({ error: "Smart Playlists are unavailable while this service is inactive." }, { status: 403 });
    }
    if (!canAuthorSmartPlaylist(context.membership.role)) {
      return NextResponse.json({ error: "Only owners, managers and content editors can edit Smart Playlists." }, { status: 403 });
    }
    const parsed = parseSmartPlaylistInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const organisationId = context.membership.organisationId;
    const existing = await prisma.smartPlaylist.findFirst({
      where: { id: params.smartPlaylistId, organisationId },
      select: { id: true, status: true, musicModeId: true, version: true }
    });
    if (!existing) return NextResponse.json({ error: "Smart Playlist not found." }, { status: 404 });
    if (existing.status === "ARCHIVED") return NextResponse.json({ error: "Archived Smart Playlists cannot be changed." }, { status: 409 });
    const slug = `${smartPlaylistSlug(parsed.data.name)}-smart`;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.smartPlaylistRule.deleteMany({ where: { smartPlaylistId: existing.id } });
      const playlist = await tx.smartPlaylist.update({
        where: { id: existing.id },
        data: {
          version: { increment: 1 },
          maxTracks: parsed.data.maxTracks,
          defaultWeight: parsed.data.defaultWeight,
          sort: parsed.data.sort,
          rightsUse: parsed.data.rightsUse,
          territory: parsed.data.territory,
          musicMode: { update: { name: parsed.data.name, slug, description: parsed.data.description } },
          rules: { create: parsed.data.rules.map((rule, position) => ({ ...rule, position })) }
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
          actorUserId: context.user.id,
          action: "SMART_PLAYLIST_RULES_UPDATED",
          entityType: "SmartPlaylist",
          entityId: existing.id,
          details: { previousVersion: existing.version, version: existing.version + 1, ruleCount: parsed.data.rules.length }
        }
      });
      return playlist;
    });
    return NextResponse.json({ ok: true, playlist: safeSmartPlaylist(updated) });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "A music mode or Smart Playlist already uses this name." }, { status: 409 });
    console.error("Smart playlist update error:", error);
    return NextResponse.json({ error: "Unable to update the Smart Playlist." }, { status: 500 });
  }
}
