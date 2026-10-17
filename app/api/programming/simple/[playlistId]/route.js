import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { normaliseGenreCode } from "@/lib/autodj-genre-entitlements.mjs";
import { parseSimplePlaylist } from "@/lib/subscriber-playlists.mjs";
import { safeSimplePlaylist } from "@/lib/subscriber-playlist-service.mjs";
import { smartPlaylistSlug } from "@/lib/smart-playlists.mjs";
import { ONLINE_DRAFT_LIMITS, lockOnlineDraftOrganisation } from "@/lib/private-preview-online-draft.mjs";

async function ownedPlaylist(organisationId, playlistId) {
  return prisma.smartPlaylist.findFirst({ where: { id: playlistId, organisationId, simpleBuildMode: { not: null } }, include: { musicMode: { select: { id: true, name: true } } } });
}

export async function PATCH(request, { params }) {
  try {
    const access = await simplePlaylistAccess({ write: true, allowOnlineDraft: true });
    if (access.response) return access.response;
    const organisationId = access.context.membership.organisationId;
    const playlist = await ownedPlaylist(organisationId, (await params).playlistId);
    if (!playlist || playlist.status === "ARCHIVED") return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
    if (access.sandboxDraftOnly && playlist.status !== "DRAFT") return NextResponse.json({ error: "Only private draft playlists can be edited in this test workspace." }, { status: 403 });
    const genres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true } });
    const parsed = parseSimplePlaylist(await request.json().catch(() => null), new Set(genres.flatMap((genre) => [normaliseGenreCode(genre.slug), normaliseGenreCode(genre.name)])));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { name, ...settings } = parsed.data;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.musicMode.update({ where: { id: playlist.musicModeId }, data: { name } });
      const saved = await tx.smartPlaylist.update({ where: { id: playlist.id }, data: { ...settings, version: { increment: 1 } }, include: { musicMode: { select: { name: true } } } });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_PLAYLIST_UPDATED", entityType: "SmartPlaylist", entityId: playlist.id, details: { buildMode: settings.simpleBuildMode, durationMinutes: settings.durationMinutes } } });
      return saved;
    });
    return NextResponse.json({ ok: true, playlist: safeSimplePlaylist(updated) });
  } catch (error) {
    console.error("Subscriber playlist update error:", error);
    return NextResponse.json({ error: "Unable to update the playlist." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const access = await simplePlaylistAccess({ write: true, allowOnlineDraft: true });
    if (access.response) return access.response;
    const organisationId = access.context.membership.organisationId;
    const playlist = await ownedPlaylist(organisationId, (await params).playlistId);
    if (!playlist || playlist.status === "ARCHIVED") return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
    if (access.sandboxDraftOnly && playlist.status !== "DRAFT") return NextResponse.json({ error: "Only private draft playlists can be copied in this test workspace." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (body?.action !== "duplicate") return NextResponse.json({ error: "Unknown playlist action." }, { status: 400 });
    const name = String(body?.name || `${playlist.musicMode.name} copy`).trim().slice(0, 120);
    if (name.length < 2) return NextResponse.json({ error: "Enter a name for the copy." }, { status: 400 });
    const copy = await prisma.$transaction(async (tx) => {
      if (access.sandboxDraftOnly) {
        await lockOnlineDraftOrganisation(tx, organisationId);
        if (await tx.smartPlaylist.count({ where: { organisationId } }) >= ONLINE_DRAFT_LIMITS.playlists) throw Object.assign(new Error("This test workspace is limited to 20 saved playlists. Edit an existing draft instead."), { code: "DRAFT_LIMIT" });
      }
      const status = access.sandboxDraftOnly ? "DRAFT" : "ACTIVE";
      const mode = await tx.musicMode.create({ data: { organisationId, name, slug: `${smartPlaylistSlug(name)}-${randomUUID().slice(0, 8)}`, source: "SMART_PLAYLIST", status } });
      const saved = await tx.smartPlaylist.create({ data: { organisationId, musicModeId: mode.id, createdByUserId: access.context.user.id, status, rightsUse: playlist.rightsUse, territory: playlist.territory, simpleBuildMode: playlist.simpleBuildMode, durationMinutes: playlist.durationMinutes, genreCodes: playlist.genreCodes }, include: { musicMode: { select: { name: true } } } });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_PLAYLIST_DUPLICATED", entityType: "SmartPlaylist", entityId: saved.id, details: { sourcePlaylistId: playlist.id } } });
      return saved;
    });
    return NextResponse.json({ ok: true, playlist: safeSimplePlaylist(copy) }, { status: 201 });
  } catch (error) {
    if (error?.code === "DRAFT_LIMIT") return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Subscriber playlist duplicate error:", error);
    return NextResponse.json({ error: "Unable to duplicate the playlist." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const access = await simplePlaylistAccess({ write: true });
    if (access.response) return access.response;
    const organisationId = access.context.membership.organisationId;
    const playlist = await ownedPlaylist(organisationId, (await params).playlistId);
    if (!playlist || playlist.status === "ARCHIVED") return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
    const now = new Date();
    const activeEvents = await prisma.subscriberPlaylistEvent.count({ where: { organisationId, smartPlaylistId: playlist.id, cancelledAt: null, endsAt: { gt: now } } });
    const confirm = new URL(request.url).searchParams.get("confirm") === "true";
    if (activeEvents && !confirm) return NextResponse.json({ error: `This playlist is used by ${activeEvents} current or future schedule item(s). Confirm archive to cancel them.`, affectedEvents: activeEvents }, { status: 409 });
    await prisma.$transaction(async (tx) => {
      await tx.subscriberPlaylistEvent.updateMany({ where: { organisationId, smartPlaylistId: playlist.id, cancelledAt: null, endsAt: { gt: now } }, data: { cancelledAt: now } });
      await tx.smartPlaylist.update({ where: { id: playlist.id }, data: { status: "ARCHIVED", musicMode: { update: { status: "ARCHIVED" } } } });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_PLAYLIST_ARCHIVED", entityType: "SmartPlaylist", entityId: playlist.id, details: { cancelledEvents: activeEvents } } });
    });
    return NextResponse.json({ ok: true, cancelledEvents: activeEvents });
  } catch (error) {
    console.error("Subscriber playlist archive error:", error);
    return NextResponse.json({ error: "Unable to archive the playlist." }, { status: 500 });
  }
}
