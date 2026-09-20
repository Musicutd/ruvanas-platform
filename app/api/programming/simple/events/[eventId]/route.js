import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { parsePlaylistEvent } from "@/lib/subscriber-playlists.mjs";
import { activeProgrammeConflict, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";

export async function PATCH(request, { params }) {
  try {
    const access = await simplePlaylistAccess({ write: true });
    if (access.response) return access.response;
    const organisationId = access.context.membership.organisationId;
    const eventId = (await params).eventId;
    const parsed = parsePlaylistEvent(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.data;
    const [existing, channel, playlist] = await Promise.all([
      prisma.subscriberPlaylistEvent.findFirst({ where: { id: eventId, organisationId, cancelledAt: null } }),
      prisma.channel.findFirst({ where: { id: input.channelId, organisationId, status: { in: ["ACTIVE", "DRAFT"] } }, include: { station: { select: { productFamily: true } }, zoneAssignments: { include: { zone: { include: { location: { select: { timezone: true } } } } }, take: 1 } } }),
      prisma.smartPlaylist.findFirst({ where: { id: input.smartPlaylistId, organisationId, status: "ACTIVE", simpleBuildMode: { not: null } } })
    ]);
    if (!existing || !channel || !playlist || playlist.rightsUse !== rightsUseForChannel(channel)) return NextResponse.json({ error: "Schedule item or compatible channel/playlist not found." }, { status: 404 });
    const channelTimezone = channel.zoneAssignments[0]?.zone?.location?.timezone;
    if (channelTimezone && channelTimezone !== input.timezone) return NextResponse.json({ error: `Use this channel's ${channelTimezone} timezone.` }, { status: 400 });
    const updated = await prisma.$transaction(async (tx) => {
      const conflict = await tx.subscriberPlaylistEvent.findFirst({ where: { id: { not: eventId }, organisationId, channelId: channel.id, cancelledAt: null, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } }, include: { smartPlaylist: { include: { musicMode: { select: { name: true } } } } } });
      if (conflict) { const error = new Error(`This overlaps “${conflict.smartPlaylist.musicMode.name}” (${conflict.startsAt.toISOString()}–${conflict.endsAt.toISOString()}).`); error.code = "PLAYLIST_OVERLAP"; throw error; }
      const programme = await activeProgrammeConflict(tx, { organisationId, channelId: channel.id, startsAt: input.startsAt, endsAt: input.endsAt });
      if (programme) { const error = new Error(`This overlaps the published programme “${programme.label}” (${programme.startsAt.toISOString()}–${programme.endsAt.toISOString()}). Choose another time or update that programme first.`); error.code = "PLAYLIST_OVERLAP"; throw error; }
      const event = await tx.subscriberPlaylistEvent.update({ where: { id: eventId }, data: input });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_PLAYLIST_SCHEDULE_UPDATED", entityType: "SubscriberPlaylistEvent", entityId: event.id, details: { channelId: channel.id, playlistId: playlist.id, startsAt: input.startsAt, endsAt: input.endsAt } } });
      return event;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, event: updated });
  } catch (error) {
    if (error?.code === "PLAYLIST_OVERLAP") return NextResponse.json({ error: error.message }, { status: 409 });
    if (error?.code === "P2034") return NextResponse.json({ error: "The schedule changed at the same time. Please try again." }, { status: 409 });
    console.error("Subscriber playlist event update error:", error);
    return NextResponse.json({ error: "Unable to update the schedule item." }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const access = await simplePlaylistAccess({ write: true });
    if (access.response) return access.response;
    const organisationId = access.context.membership.organisationId;
    const event = await prisma.subscriberPlaylistEvent.findFirst({ where: { id: (await params).eventId, organisationId, cancelledAt: null } });
    if (!event) return NextResponse.json({ error: "Schedule item not found." }, { status: 404 });
    await prisma.$transaction(async (tx) => {
      await tx.subscriberPlaylistEvent.update({ where: { id: event.id }, data: { cancelledAt: new Date() } });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_PLAYLIST_SCHEDULE_CANCELLED", entityType: "SubscriberPlaylistEvent", entityId: event.id, details: { channelId: event.channelId, playlistId: event.smartPlaylistId } } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Subscriber playlist cancel error:", error);
    return NextResponse.json({ error: "Unable to cancel the schedule item." }, { status: 500 });
  }
}
