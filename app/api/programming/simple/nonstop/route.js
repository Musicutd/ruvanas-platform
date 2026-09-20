import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { normaliseGenreCode } from "@/lib/autodj-genre-entitlements.mjs";
import { loadEligibleSubscriberMusic, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";

const schema = z.object({ channelId: z.string().cuid(), enabled: z.boolean(), genreCodes: z.array(z.string().min(1).max(80)).max(24).default([]) });

export async function PUT(request) {
  try {
    const access = await simplePlaylistAccess({ write: true });
    if (access.response) return access.response;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a channel and optional genres." }, { status: 400 });
    const organisationId = access.context.membership.organisationId;
    const channel = await prisma.channel.findFirst({ where: { id: parsed.data.channelId, organisationId, status: { in: ["ACTIVE", "DRAFT"] } }, include: { station: { select: { productFamily: true } } } });
    if (!channel) return NextResponse.json({ error: "Choose a channel owned by your organisation." }, { status: 404 });
    const genreCodes = [...new Set(parsed.data.genreCodes.map(normaliseGenreCode))];
    const configuredGenres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true, active: true, minimumCatalogueLevel: true } });
    const allowedCodes = new Set(configuredGenres.map((genre) => normaliseGenreCode(genre.slug)));
    if (genreCodes.some((code) => !allowedCodes.has(code))) return NextResponse.json({ error: "Choose only active music genres." }, { status: 400 });
    const rightsUse = rightsUseForChannel(channel);
    if (!rightsUse) return NextResponse.json({ error: "This channel needs a music-rights profile before AutoDJ can be enabled." }, { status: 409 });
    const scopes = rightsUse === "ONLINE_RADIO" ? ["SUBSCRIBER_LIBRARY", "RUVANAS_CORE"] : ["SUBSCRIBER_LIBRARY", "RUVANAS_CORE", "LICENSED_CATALOGUE"];
    const entries = parsed.data.enabled ? await loadEligibleSubscriberMusic(prisma, {
      organisationId, requiredUse: rightsUse, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel,
      configuredGenres, sourceScopes: scopes
    }) : [];
    const selected = genreCodes.length ? entries.filter((entry) => entry.genreCodes.some((code) => genreCodes.includes(code))) : entries;
    if (parsed.data.enabled && !selected.length) return NextResponse.json({ error: "No rights-approved songs match this channel and genre selection yet." }, { status: 400 });
    const saved = await prisma.$transaction(async (tx) => {
      const slug = `nonstop-${channel.id}`;
      let mode = await tx.musicMode.findUnique({ where: { organisationId_slug: { organisationId, slug } } });
      if (!mode) mode = await tx.musicMode.create({ data: { organisationId, name: `AutoDJ Non-Stop · ${channel.name}`, slug, status: "ACTIVE" } });
      else if (mode.status !== "ACTIVE") mode = await tx.musicMode.update({ where: { id: mode.id }, data: { status: "ACTIVE" } });
      if (parsed.data.enabled) {
        await tx.musicModeTrack.deleteMany({ where: { musicModeId: mode.id } });
        await tx.musicModeTrack.createMany({ data: selected.slice(0, 500).map((entry) => ({ musicModeId: mode.id, trackId: entry.track.id, weight: 100 })) });
      }
      const policy = await tx.autoDjPolicy.upsert({
        where: { channelId_organisationId: { channelId: channel.id, organisationId } },
        create: { organisationId, channelId: channel.id, enabled: parsed.data.enabled, state: parsed.data.enabled ? "ACTIVE" : "DRAFT", defaultMusicModeId: mode.id, playbackPolicy: "RUN_24_7", rightsUse, selectedGenreCodes: genreCodes, sourceScopes: scopes, entitlementLevel: access.entitlements.licensedMusicCatalogueLevel },
        update: { enabled: parsed.data.enabled, state: parsed.data.enabled ? "ACTIVE" : "PAUSED", defaultMusicModeId: mode.id, playbackPolicy: "RUN_24_7", rightsUse, selectedGenreCodes: genreCodes, sourceScopes: scopes, entitlementLevel: access.entitlements.licensedMusicCatalogueLevel, blockedReason: null }
      });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_NONSTOP_UPDATED", entityType: "AutoDjPolicy", entityId: policy.id, details: { channelId: channel.id, enabled: parsed.data.enabled, genreCodes, availableTracks: selected.length } } });
      return policy;
    });
    return NextResponse.json({ ok: true, enabled: saved.enabled, genreCodes, playableTrackCount: selected.length });
  } catch (error) {
    console.error("Subscriber Non-Stop error:", error);
    return NextResponse.json({ error: "Unable to save AutoDJ Non-Stop." }, { status: 500 });
  }
}
