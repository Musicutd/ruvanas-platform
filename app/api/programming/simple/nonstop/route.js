import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { normaliseGenreCode } from "@/lib/autodj-genre-entitlements.mjs";
import { loadEligibleSubscriberMusic, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";
import { resolveAutoDjTarget } from "@/lib/autodj-targets";
import { canManageSubscriberProgramming } from "@/lib/subscriber-programming.mjs";
import { subscriberProductAccess } from "@/lib/product-access.mjs";
import { assertCorrectionsSchedulingAllowed } from "@/lib/corrections-scheduling-lock.mjs";

const schema = z.object({
  channelId: z.string().cuid(), enabled: z.boolean(),
  genreCodes: z.array(z.string().min(1).max(80)).max(24).default([]),
  playbackPolicy: z.enum(["FOLLOW_LOCATION_HOURS", "RUN_24_7"]).optional(),
  sourceScopes: z.array(z.enum(["SUBSCRIBER_LIBRARY", "RUVANAS_CORE", "LICENSED_CATALOGUE"])).min(1).max(3).optional(),
  targetType: z.enum(["ZONE"]).optional(), targetId: z.string().cuid().optional()
});

export async function PUT(request) {
  try {
    const access = await simplePlaylistAccess({ write: true });
    if (access.response) return access.response;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a channel and optional genres." }, { status: 400 });
    if (Boolean(parsed.data.targetType) !== Boolean(parsed.data.targetId)) return NextResponse.json({ error: "Choose a complete listening area." }, { status: 400 });
    if (parsed.data.targetType && !canManageSubscriberProgramming(access.context.membership.role)) {
      return NextResponse.json({ error: "Only an organisation owner or manager can change automatic music for a listening area." }, { status: 403 });
    }
    const organisationId = access.context.membership.organisationId;
    const channel = await prisma.channel.findFirst({ where: { id: parsed.data.channelId, organisationId, status: { in: ["ACTIVE", "DRAFT"] } }, include: {
      station: { select: { productFamily: true } }, autoDjPolicy: { select: { territory: true } },
      zoneAssignments: { where: { activeFrom: { lte: new Date() }, OR: [{ activeTo: null }, { activeTo: { gt: new Date() } }] }, include: { zone: { include: { location: { select: { countryCode: true } } } } } }
    } });
    if (!channel) return NextResponse.json({ error: "Choose a channel owned by your organisation." }, { status: 404 });
    const genreCodes = [...new Set(parsed.data.genreCodes.map(normaliseGenreCode))];
    const configuredGenres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true, active: true, minimumCatalogueLevel: true } });
    const allowedCodes = new Set(configuredGenres.map((genre) => normaliseGenreCode(genre.slug)));
    if (genreCodes.some((code) => !allowedCodes.has(code))) return NextResponse.json({ error: "Choose only active music genres." }, { status: 400 });
    const rightsUse = rightsUseForChannel(channel);
    if (!rightsUse) return NextResponse.json({ error: "This channel needs a music-rights profile before AutoDJ can be enabled." }, { status: 409 });
    const product = { RETAIL_RADIO: "RETAIL", SCHOOL_RADIO: "SCHOOL", ONLINE_RADIO: "ONLINE", HEALTH_RADIO: "HEALTH", FAITH_RADIO: "FAITH", ORGANISATIONS_RADIO: "ORGANISATIONS" }[rightsUse];
    if (!subscriberProductAccess(access.entitlements, product).allowed) return NextResponse.json({ error: "This service is not included in your account." }, { status: 403 });
    let target = null;
    if (parsed.data.targetType) {
      try {
        target = await resolveAutoDjTarget(organisationId, parsed.data.targetType, parsed.data.targetId, access.entitlements);
      } catch (error) {
        if (error.code === "TARGET_NOT_ALLOWED") return NextResponse.json({ error: error.message }, { status: 403 });
        throw error;
      }
    }
    if (target && (target.channelId !== channel.id || target.rightsUse !== rightsUse)) {
      return NextResponse.json({ error: "This area needs its own assigned Retail channel before music can be saved." }, { status: 409 });
    }
    const defaultScopes = ["SUBSCRIBER_LIBRARY", access.entitlements.includesRuvanasCatalogue ? "RUVANAS_CORE" : null, access.entitlements.licensedMusicCatalogueEnabled && channel.station?.productFamily !== "ONLINE" ? "LICENSED_CATALOGUE" : null].filter(Boolean);
    const scopes = [...new Set(parsed.data.sourceScopes || defaultScopes)];
    if (parsed.data.sourceScopes?.includes("RUVANAS_CORE") && !access.entitlements.includesRuvanasCatalogue) return NextResponse.json({ error: "The Ruvanas catalogue is not included in this plan." }, { status: 403 });
    if (parsed.data.sourceScopes?.includes("LICENSED_CATALOGUE") && !access.entitlements.licensedMusicCatalogueEnabled) return NextResponse.json({ error: "The Licensed Music Catalogue is not included in this plan." }, { status: 403 });
    if (channel.station?.productFamily === "ONLINE" && scopes.includes("LICENSED_CATALOGUE")) return NextResponse.json({ error: "Licensed catalogue output is not verified for Online Radio yet. Choose other approved music." }, { status: 409 });
    if (channel.station?.productFamily === "ONLINE" && parsed.data.playbackPolicy && parsed.data.playbackPolicy !== "RUN_24_7") return NextResponse.json({ error: "Online Radio AutoDJ must run continuously." }, { status: 400 });
    const territory = target?.territory || channel.autoDjPolicy?.territory || (channel.zoneAssignments.length === 1 ? channel.zoneAssignments[0].zone.location.countryCode : null);
    const entries = parsed.data.enabled ? await loadEligibleSubscriberMusic(prisma, {
      organisationId, requiredUse: rightsUse, territory, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel,
      configuredGenres, sourceScopes: scopes
    }) : [];
    const selected = genreCodes.length ? entries.filter((entry) => entry.genreCodes.some((code) => genreCodes.includes(code))) : entries;
    if (parsed.data.enabled && !selected.length) return NextResponse.json({ error: "No rights-approved songs match this channel and genre selection yet." }, { status: 400 });
    const saved = await prisma.$transaction(async (tx) => {
      if (parsed.data.enabled) await assertCorrectionsSchedulingAllowed(tx, { organisationId, channelId: channel.id, ...(target?.type === "ZONE" ? { zoneId: target.id } : {}) });
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
        create: { organisationId, channelId: channel.id, enabled: parsed.data.enabled, state: parsed.data.enabled ? "ACTIVE" : "DRAFT", defaultMusicModeId: mode.id, playbackPolicy: parsed.data.playbackPolicy || "RUN_24_7", rightsUse, territory, ...(target ? { targetType: target.type, targetId: target.id } : {}), selectedGenreCodes: genreCodes, sourceScopes: scopes, entitlementLevel: access.entitlements.licensedMusicCatalogueLevel },
        update: { enabled: parsed.data.enabled, state: parsed.data.enabled ? "ACTIVE" : "PAUSED", defaultMusicModeId: mode.id, playbackPolicy: parsed.data.playbackPolicy || "RUN_24_7", rightsUse, territory, ...(target ? { targetType: target.type, targetId: target.id } : {}), selectedGenreCodes: genreCodes, sourceScopes: scopes, entitlementLevel: access.entitlements.licensedMusicCatalogueLevel, blockedReason: null }
      });
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.context.user.id, action: "SUBSCRIBER_NONSTOP_UPDATED", entityType: "AutoDjPolicy", entityId: policy.id, details: { channelId: channel.id, enabled: parsed.data.enabled, genreCodes, sourceScopes: scopes, territory, targetType: target?.type || null, targetId: target?.id || null, availableTracks: selected.length } } });
      return policy;
    });
    return NextResponse.json({ ok: true, enabled: saved.enabled, genreCodes, playableTrackCount: selected.length });
  } catch (error) {
    if (error?.code === "CORRECTIONS_SCHEDULING_LOCKED") return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Subscriber Non-Stop error:", error);
    return NextResponse.json({ error: "Unable to save AutoDJ Non-Stop." }, { status: 500 });
  }
}
