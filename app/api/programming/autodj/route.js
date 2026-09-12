import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canManageSubscriberProgramming } from "@/lib/subscriber-programming.mjs";
import { musicModeIsPlayable } from "@/lib/music-mode-playback.mjs";
import { normalizeAutoDjPolicyInput } from "@/lib/autodj-policy.mjs";
import { assertGenreSelection } from "@/lib/autodj-genre-entitlements.mjs";
import { resolveAutoDjTarget } from "@/lib/autodj-targets";

export const dynamic = "force-dynamic";

const policySchema = z.object({
  channelId: z.string().cuid(),
  enabled: z.boolean(),
  defaultMusicModeId: z.string().cuid().optional().nullable(),
  backupMusicModeId: z.string().cuid().optional().nullable(),
  playbackPolicy: z.enum(["FOLLOW_LOCATION_HOURS", "RUN_24_7"]),
  state: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).optional(),
  targetType: z.enum(["LOCATION", "ZONE", "SCHOOL", "CHANNEL", "HEALTH_CHANNEL", "FAITH_CHANNEL", "ORGANISATIONS_CHANNEL"]).optional(),
  targetId: z.string().max(120).optional().nullable(),
  rightsUse: z.enum(["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO", "HEALTH_RADIO", "FAITH_RADIO", "ORGANISATIONS_RADIO"]).optional(),
  territory: z.string().max(80).optional().nullable(),
  sourceScopes: z.array(z.enum(["SUBSCRIBER_LIBRARY", "RUVANAS_CORE", "LICENSED_CATALOGUE"])).min(1).max(3).optional(),
  selectedGenreCodes: z.array(z.string().max(80)).min(1).max(24).optional()
});

const playbackModeInclude = {
  tracks: { include: { track: { include: { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } } } } } }
};

export async function PUT(request) {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    const entitlements = resolveEntitlements(context.membership.organisation.subscription);
    if (!entitlements.serviceEnabled) {
      return NextResponse.json({ error: "Radio programming is unavailable while this service is inactive." }, { status: 403 });
    }
    if (!canManageSubscriberProgramming(context.membership.role)) {
      return NextResponse.json({ error: "Only organisation owners and managers can change Continuous AutoDJ." }, { status: 403 });
    }

    const parsed = policySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a channel and valid AutoDJ settings." }, { status: 400 });
    let input;
    try {
      input = normalizeAutoDjPolicyInput(parsed.data);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const organisationId = context.membership.organisationId;
    const expansion = {};
    let resolvedTarget = null;
    if (parsed.data.targetType && parsed.data.targetId) {
      const target = await resolveAutoDjTarget(organisationId, parsed.data.targetType, parsed.data.targetId, entitlements);
      resolvedTarget = target;
      expansion.targetType = target.type;
      expansion.targetId = target.id;
      expansion.rightsUse = target.rightsUse;
      expansion.territory = parsed.data.territory || target.territory || null;
    }
    if (parsed.data.sourceScopes || parsed.data.selectedGenreCodes) {
      const genres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 250 });
      try {
        Object.assign(expansion, assertGenreSelection({ selectedGenreCodes: parsed.data.selectedGenreCodes, sourceScopes: parsed.data.sourceScopes, catalogueLevel: entitlements.licensedMusicCatalogueLevel, configuredGenres: genres }));
      } catch (error) {
        return NextResponse.json({ error: error.message, code: error.code || "INVALID_GENRE_SELECTION" }, { status: 403 });
      }
    }
    expansion.state = parsed.data.state || (input.enabled ? "ACTIVE" : "DRAFT");
    expansion.entitlementLevel = entitlements.licensedMusicCatalogueLevel;
    expansion.blockedReason = null;
    const channel = await prisma.channel.findFirst({
      where: { id: parsed.data.channelId, organisationId, status: "ACTIVE", ...(resolvedTarget?.channelId ? { id: resolvedTarget.channelId } : {}) },
      select: { id: true, name: true }
    });
    if (!channel) return NextResponse.json({ error: "The selected channel is not available to your organisation." }, { status: 404 });

    const modeIds = [...new Set([input.defaultMusicModeId, input.backupMusicModeId].filter(Boolean))];
    const modes = await prisma.musicMode.findMany({
      where: { id: { in: modeIds }, organisationId, status: "ACTIVE" },
      include: playbackModeInclude
    });
    if (modes.length !== modeIds.length) {
      return NextResponse.json({ error: "Choose only active music modes approved for your organisation." }, { status: 400 });
    }
    const modeById = new Map(modes.map((mode) => [mode.id, mode]));
    const eligibilityOptions = { organisationId, requiredUse: expansion.rightsUse || parsed.data.rightsUse || null, territory: expansion.territory || null, licensedCatalogueLevel: entitlements.licensedMusicCatalogueLevel, selectedGenreCodes: expansion.selectedGenreCodes || null };
    if (input.enabled && !musicModeIsPlayable(modeById.get(input.defaultMusicModeId), new Date(), eligibilityOptions)) {
      return NextResponse.json({ error: "The default music mode needs at least one playable, rights-approved track." }, { status: 400 });
    }
    if (input.backupMusicModeId && !musicModeIsPlayable(modeById.get(input.backupMusicModeId), new Date(), eligibilityOptions)) {
      return NextResponse.json({ error: "The backup music mode needs at least one playable, rights-approved track." }, { status: 400 });
    }

    const saved = await prisma.$transaction(async (tx) => {
      const policyKey = { channelId: channel.id, organisationId };
      const previous = await tx.autoDjPolicy.findUnique({
        where: { channelId_organisationId: policyKey }
      });
      const policy = await tx.autoDjPolicy.upsert({
        where: { channelId_organisationId: policyKey },
        create: { organisationId, channelId: channel.id, ...input, ...expansion },
        update: { ...input, ...expansion }
      });
      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: context.user.id,
          action: "CONTINUOUS_AUTODJ_POLICY_UPDATED",
          entityType: "AutoDjPolicy",
          entityId: policy.id,
          details: {
            channelId: channel.id,
            channelName: channel.name,
            previous: previous ? {
              enabled: previous.enabled,
              defaultMusicModeId: previous.defaultMusicModeId,
              backupMusicModeId: previous.backupMusicModeId,
              playbackPolicy: previous.playbackPolicy
            } : null,
            current: { ...input, ...expansion }
          }
        }
      });
      const changeEvents = [
        previous?.enabled !== input.enabled ? {
          action: input.enabled ? "CONTINUOUS_AUTODJ_ENABLED" : "CONTINUOUS_AUTODJ_DISABLED",
          details: { previous: previous?.enabled ?? null, current: input.enabled }
        } : null,
        previous?.defaultMusicModeId !== input.defaultMusicModeId ? {
          action: "AUTODJ_DEFAULT_MODE_CHANGED",
          details: { previousMusicModeId: previous?.defaultMusicModeId || null, currentMusicModeId: input.defaultMusicModeId }
        } : null,
        previous?.backupMusicModeId !== input.backupMusicModeId ? {
          action: "AUTODJ_BACKUP_MODE_CHANGED",
          details: { previousMusicModeId: previous?.backupMusicModeId || null, currentMusicModeId: input.backupMusicModeId }
        } : null,
        previous?.playbackPolicy !== input.playbackPolicy ? {
          action: "AUTODJ_PLAYBACK_POLICY_CHANGED",
          details: { previous: previous?.playbackPolicy || null, current: input.playbackPolicy }
        } : null
      ].filter(Boolean);
      if (changeEvents.length) {
        await tx.auditLog.createMany({
          data: changeEvents.map((event) => ({
            organisationId,
            actorUserId: context.user.id,
            action: event.action,
            entityType: "AutoDjPolicy",
            entityId: policy.id,
            details: { channelId: channel.id, ...event.details }
          }))
        });
      }
      return policy;
    });

    return NextResponse.json({ ok: true, policy: saved });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "These AutoDJ settings changed at the same time. Please retry." }, { status: 409 });
    console.error("Continuous AutoDJ save error:", error);
    return NextResponse.json({ error: "Unable to save Continuous AutoDJ settings." }, { status: 500 });
  }
}
