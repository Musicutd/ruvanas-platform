import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canManageSubscriberProgramming } from "@/lib/subscriber-programming.mjs";
import { musicModeIsPlayable } from "@/lib/music-mode-playback.mjs";
import { normalizeAutoDjPolicyInput } from "@/lib/autodj-policy.mjs";

export const dynamic = "force-dynamic";

const policySchema = z.object({
  channelId: z.string().cuid(),
  enabled: z.boolean(),
  defaultMusicModeId: z.string().cuid().optional().nullable(),
  backupMusicModeId: z.string().cuid().optional().nullable(),
  playbackPolicy: z.enum(["FOLLOW_LOCATION_HOURS", "RUN_24_7"])
});

const playbackModeInclude = {
  tracks: { include: { track: { include: { mediaAsset: true } } } }
};

export async function PUT(request) {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
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
    const channel = await prisma.channel.findFirst({
      where: { id: parsed.data.channelId, organisationId, status: "ACTIVE" },
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
    if (input.enabled && !musicModeIsPlayable(modeById.get(input.defaultMusicModeId))) {
      return NextResponse.json({ error: "The default music mode needs at least one playable, licensed catalogue track." }, { status: 400 });
    }
    if (input.backupMusicModeId && !musicModeIsPlayable(modeById.get(input.backupMusicModeId))) {
      return NextResponse.json({ error: "The backup music mode needs at least one playable, licensed catalogue track." }, { status: 400 });
    }

    const saved = await prisma.$transaction(async (tx) => {
      const policyKey = { channelId: channel.id, organisationId };
      const previous = await tx.autoDjPolicy.findUnique({
        where: { channelId_organisationId: policyKey }
      });
      const policy = await tx.autoDjPolicy.upsert({
        where: { channelId_organisationId: policyKey },
        create: { organisationId, channelId: channel.id, ...input },
        update: input
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
            current: input
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
