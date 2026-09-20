import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { parsePlaylistEvent } from "@/lib/subscriber-playlists.mjs";
import { activeProgrammeConflict, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";

export async function POST(request) {
  try {
    const access = await simplePlaylistAccess({ write: true });
    if (access.response) return access.response;
    const organisationId = access.context.membership.organisationId;
    const parsed = parsePlaylistEvent(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.data;
    const channel = await prisma.channel.findFirst({ where: { id: input.channelId, organisationId, status: { in: ["ACTIVE", "DRAFT"] } }, include: { station: { select: { productFamily: true } }, zoneAssignments: { include: { zone: { include: { location: { select: { timezone: true } } } } }, take: 1 } } });
    if (!channel) return NextResponse.json({ error: "Choose a channel owned by your organisation." }, { status: 404 });
    const channelTimezone = channel.zoneAssignments[0]?.zone?.location?.timezone;
    if (channelTimezone && channelTimezone !== input.timezone) return NextResponse.json({ error: `Use this channel's ${channelTimezone} timezone.` }, { status: 400 });
    const playlist = await prisma.smartPlaylist.findFirst({ where: { id: input.smartPlaylistId, organisationId, status: "ACTIVE", simpleBuildMode: { not: null }, rightsUse: rightsUseForChannel(channel) }, select: { id: true, musicMode: { select: { name: true } } } });
    if (!playlist) return NextResponse.json({ error: "Choose a saved playlist compatible with this channel." }, { status: 404 });
    const created = await prisma.$transaction(async (tx) => {
      const conflict = await tx.subscriberPlaylistEvent.findFirst({ where: { organisationId, channelId: channel.id, cancelledAt: null, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } }, include: { smartPlaylist: { include: { musicMode: { select: { name: true } } } } } });
      if (conflict) { const error = new Error(`This overlaps “${conflict.smartPlaylist.musicMode.name}” (${conflict.startsAt.toISOString()}–${conflict.endsAt.toISOString()}).`); error.code = "PLAYLIST_OVERLAP"; throw error; }
      const programme = await activeProgrammeConflict(tx, { organisationId, channelId: channel.id, startsAt: input.startsAt, endsAt: input.endsAt });
      if (programme) { const error = new Error(`This overlaps the published programme “${programme.label}” (${programme.startsAt.toISOString()}–${programme.endsAt.toISOString()}). Choose another time or update that programme first.`); error.code = "PLAYLIST_OVERLAP"; throw error; }
      const event = await tx.subscriberPlaylistEvent.create({ data: { organisationId, createdByUserId: access.context.user.id, ...input } });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_PLAYLIST_SCHEDULED", entityType: "SubscriberPlaylistEvent", entityId: event.id, details: { channelId: channel.id, playlistId: playlist.id, startsAt: input.startsAt, endsAt: input.endsAt } } });
      return event;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, event: created }, { status: 201 });
  } catch (error) {
    if (error?.code === "PLAYLIST_OVERLAP") return NextResponse.json({ error: error.message }, { status: 409 });
    if (error?.code === "P2034") return NextResponse.json({ error: "The schedule changed at the same time. Please try again." }, { status: 409 });
    console.error("Subscriber playlist schedule error:", error);
    return NextResponse.json({ error: "Unable to schedule this playlist." }, { status: 500 });
  }
}
