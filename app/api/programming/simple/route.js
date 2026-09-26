import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { normaliseGenreCode } from "@/lib/autodj-genre-entitlements.mjs";
import { parseSimplePlaylist } from "@/lib/subscriber-playlists.mjs";
import { safeSimplePlaylist, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";
import { smartPlaylistSlug } from "@/lib/smart-playlists.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await simplePlaylistAccess();
    if (access.response) return access.response;
    const organisationId = access.context.membership.organisationId;
    const [channels, playlists, events, genres] = await Promise.all([
      prisma.channel.findMany({ where: { organisationId, status: { in: ["ACTIVE", "DRAFT"] } }, include: {
        station: { select: { id: true, name: true, productFamily: true, status: true, streamConfig: { select: { streamUrl: true } } } },
        autoDjPolicy: { select: { enabled: true, selectedGenreCodes: true, playbackPolicy: true } },
        zoneAssignments: { include: { zone: { include: { location: { select: { timezone: true } } } } }, take: 1 }
      }, orderBy: { name: "asc" } }),
      prisma.smartPlaylist.findMany({ where: { organisationId, simpleBuildMode: { not: null }, status: { not: "ARCHIVED" } }, include: { musicMode: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 200 }),
      prisma.subscriberPlaylistEvent.findMany({ where: { organisationId, cancelledAt: null, endsAt: { gt: new Date() } }, include: { smartPlaylist: { include: { musicMode: { select: { name: true } } } }, channel: { select: { name: true } } }, orderBy: { startsAt: "asc" }, take: 200 }),
      prisma.mediaGenre.findMany({ where: { active: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } })
    ]);
    return NextResponse.json({
      ok: true,
      canManage: ["OWNER", "MANAGER", "CONTENT_EDITOR"].includes(access.context.membership.role),
      channels: channels.map((channel) => ({
        id: channel.id, name: channel.name, status: channel.status,
        productFamily: channel.station?.productFamily || ({ RETAIL_RADIO: "RETAIL", SCHOOL_RADIO: "SCHOOL", ONLINE_RADIO: "ONLINE", HEALTH_RADIO: "HEALTH", FAITH_RADIO: "FAITH", ORGANISATIONS_RADIO: "ORGANISATIONS" }[rightsUseForChannel(channel)] || "RETAIL"),
        rightsUse: rightsUseForChannel(channel), timezone: channel.zoneAssignments[0]?.zone?.location?.timezone || "Europe/Malta",
        stationName: channel.station?.name || null,
        streamingStatus: !rightsUseForChannel(channel) ? "RIGHTS_PROFILE_REQUIRED" : channel.station ? (channel.station.streamConfig?.streamUrl ? "CONFIGURED" : "PENDING_MANUAL_CONFIGURATION") : "RUVANAS_PLAYBACK",
        nonStop: { enabled: channel.autoDjPolicy?.enabled === true, genreCodes: Array.isArray(channel.autoDjPolicy?.selectedGenreCodes) ? channel.autoDjPolicy.selectedGenreCodes : [], playbackPolicy: channel.autoDjPolicy?.playbackPolicy || "RUN_24_7" }
      })),
      genres: genres.map((genre) => ({ id: genre.id, name: genre.name, code: normaliseGenreCode(genre.slug) })),
      playlists: playlists.map(safeSimplePlaylist),
      events: events.map((event) => ({ id: event.id, channelId: event.channelId, channelName: event.channel.name, playlistId: event.smartPlaylistId, playlistName: event.smartPlaylist.musicMode.name, startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone }))
    });
  } catch (error) {
    console.error("Subscriber playlist load error:", error);
    return NextResponse.json({ error: "Unable to load playlists." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await simplePlaylistAccess({ write: true });
    if (access.response) return access.response;
    const body = await request.json().catch(() => null);
    const organisationId = access.context.membership.organisationId;
    const channel = await prisma.channel.findFirst({ where: { id: body?.channelId, organisationId, status: { in: ["ACTIVE", "DRAFT"] } }, include: { station: { select: { productFamily: true } } } });
    if (!channel) return NextResponse.json({ error: "Choose a channel owned by your organisation." }, { status: 404 });
    if (!rightsUseForChannel(channel)) return NextResponse.json({ error: "This channel needs a music-rights profile before playlists can be created." }, { status: 409 });
    const genres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true } });
    const parsed = parseSimplePlaylist(body, new Set(genres.flatMap((genre) => [normaliseGenreCode(genre.slug), normaliseGenreCode(genre.name)])));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { name, ...settings } = parsed.data;
    const created = await prisma.$transaction(async (tx) => {
      const musicMode = await tx.musicMode.create({ data: { organisationId, name, slug: `${smartPlaylistSlug(name)}-${randomUUID().slice(0, 8)}`, source: "SMART_PLAYLIST", status: "ACTIVE" } });
      const playlist = await tx.smartPlaylist.create({ data: { organisationId, musicModeId: musicMode.id, createdByUserId: access.context.user.id, status: "ACTIVE", rightsUse: rightsUseForChannel(channel), ...settings }, include: { musicMode: { select: { name: true } } } });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_PLAYLIST_CREATED", entityType: "SmartPlaylist", entityId: playlist.id, details: { channelId: channel.id, buildMode: settings.simpleBuildMode, durationMinutes: settings.durationMinutes } } });
      return playlist;
    });
    return NextResponse.json({ ok: true, playlist: safeSimplePlaylist(created) }, { status: 201 });
  } catch (error) {
    console.error("Subscriber playlist create error:", error);
    return NextResponse.json({ error: "Unable to save the playlist." }, { status: 500 });
  }
}
