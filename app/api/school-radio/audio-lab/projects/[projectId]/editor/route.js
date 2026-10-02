import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveStudio } from "@/lib/studio-access";
import { assertStudioWaveformWriteAllowed, normalizeEditorState } from "@/lib/waveform-editor.mjs";
import { normalizeVoiceCleanup } from "@/lib/voice-cleanup.mjs";
import { applyStudioMasteringPreset, normalizeStudioEffects, normalizeStudioMastering } from "@/lib/studio-effects-mastering.mjs";
import { saveStudioWaveformSnapshot, serializeStudioWaveformProject, studioWaveformEditorInclude } from "@/lib/studio-waveform-persistence";
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, assertGeneralStudioAudioProject, generalStudioMediaAssetIds, generalStudioUsableMediaAssetIds } from "@/lib/studio-general-asset-boundary.mjs";

export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("INITIALIZE"), takeId: z.string().cuid() }),
  z.object({ action: z.literal("SAVE"), state: z.record(z.unknown()), reason: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("QUEUE_RENDER"), state: z.record(z.unknown()), preset: z.enum(["SCHOOL_RADIO_MP3", "SPEECH_MP3", "WAV_MASTER"]) }),
  z.object({ action: z.literal("QUEUE_CLEANUP_PREVIEW"), state: z.record(z.unknown()) }),
  z.object({ action: z.literal("QUEUE_MASTER_PREVIEW"), state: z.record(z.unknown()) })
]);

async function assertGeneralWaveformProjectMedia(database, organisationId, project) {
  const promoOutputs = project.renders.length ? await database.audioRender.findMany({
    where: { id: { in: project.renders.map((render) => render.id) }, projectId: project.id },
    select: { outputPromoVersion: { select: { mediaAssetId: true } } }
  }) : [];
  const assetIds = [...new Set([
    ...project.takes.map((take) => take.mediaAsset.id),
    ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.mediaAssetId)),
    ...project.renders.map((render) => render.outputMediaAsset?.id),
    ...promoOutputs.map((render) => render.outputPromoVersion?.mediaAssetId)
  ].filter(Boolean))];
  const usable = await generalStudioUsableMediaAssetIds(database, organisationId, assetIds);
  if (usable.size !== assetIds.length) throw Object.assign(new Error("The AudioLab project contains media unavailable in general Studio."), { status: 403 });
}

export async function GET(_request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const projectId = (await params).projectId;
  const project = await prisma.audioProject.findFirst({
    where: { id: projectId, organisationId: access.organisation.id, status: { not: "ARCHIVED" }, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE },
    include: studioWaveformEditorInclude
  });
  if (!project) return NextResponse.json({ error: "The AudioLab project was not found." }, { status: 404 });
  try {
    await assertGeneralWaveformProjectMedia(prisma, access.organisation.id, project);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The AudioLab project is unavailable." }, { status: error?.status || 403 });
  }
  return NextResponse.json(serializeStudioWaveformProject(project, access.entitlements));
}

export async function POST(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The waveform editor request is invalid." }, { status: 400 });
  const projectId = (await params).projectId;
  const project = await prisma.audioProject.findFirst({ where: { id: projectId, organisationId: access.organisation.id, status: { not: "ARCHIVED" }, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE } });
  if (!project) return NextResponse.json({ error: "The AudioLab project was not found." }, { status: 404 });
  try {
    if (parsed.data.action === "INITIALIZE") {
      const take = await prisma.audioTake.findFirst({ where: { id: parsed.data.takeId, projectId, organisationId: access.organisation.id, status: { in: ["READY", "PROCESSING"] }, trashedAt: null }, include: { mediaAsset: true } });
      if (!take) return NextResponse.json({ error: "Choose an available source take from this project." }, { status: 404 });
      const durationMs = take.durationMs || (take.mediaAsset.durationSeconds ? take.mediaAsset.durationSeconds * 1000 : 0);
      if (!durationMs) return NextResponse.json({ error: "This take is still being analysed. Try again shortly." }, { status: 409 });
      const state = { clips: [{ clientId: `take-${take.id}`, kind: "SOURCE", mediaAssetId: take.mediaAssetId, sourceStartMs: 0, sourceEndMs: durationMs, timelineStartMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 0, fadeInCurve: "linear", fadeOutCurve: "linear", locked: false }], markers: [], normalize: true, targetLufs: -16, noiseCleanup: false, voiceCleanup: normalizeVoiceCleanup(), effects: normalizeStudioEffects(), mastering: applyStudioMasteringPreset("PODCAST") };
      await prisma.$transaction(async (tx) => {
        await assertGeneralStudioAudioProject(tx, access.organisation.id, projectId);
        const sources = await generalStudioMediaAssetIds(tx, access.organisation.id, [take.mediaAssetId]);
        if (!sources.has(take.mediaAssetId)) throw Object.assign(new Error("This source take is not available in general Studio."), { status: 403 });
        return saveStudioWaveformSnapshot(tx, { project, userId: access.user.id, state, reason: "Waveform editor initialized" });
      });
    } else {
      const renderRequested = parsed.data.action === "QUEUE_RENDER";
      const cleanupPreviewRequested = parsed.data.action === "QUEUE_CLEANUP_PREVIEW";
      const masterPreviewRequested = parsed.data.action === "QUEUE_MASTER_PREVIEW";
      const requestedState = normalizeEditorState(parsed.data.state);
      assertStudioWaveformWriteAllowed(requestedState, access.entitlements);
      if (cleanupPreviewRequested && !requestedState.voiceCleanup.enabled) {
        return NextResponse.json({ error: "Choose a Voice Cleanup preset before creating a comparison." }, { status: 409 });
      }
      if (masterPreviewRequested && !requestedState.effects.enabled && !requestedState.mastering.enabled) {
        return NextResponse.json({ error: "Choose an Effects or Mastering preset before creating a preview." }, { status: 409 });
      }
      const saved = await prisma.$transaction(async (tx) => {
        await assertGeneralStudioAudioProject(tx, access.organisation.id, projectId);
        const sourceIds = [...new Set(requestedState.clips.filter((clip) => clip.kind === "SOURCE").map((clip) => clip.mediaAssetId))];
        const sources = await generalStudioMediaAssetIds(tx, access.organisation.id, sourceIds);
        if (sources.size !== sourceIds.length) throw Object.assign(new Error("One or more clip sources are not available in general Studio."), { status: 403 });
        return saveStudioWaveformSnapshot(tx, { project, userId: access.user.id, state: requestedState, reason: renderRequested ? "Final render requested" : cleanupPreviewRequested ? "Voice cleanup comparison requested" : masterPreviewRequested ? "Effects and mastering preview requested" : parsed.data.reason || "Waveform editor save" });
      });
      if (parsed.data.action === "QUEUE_RENDER") {
        await prisma.$transaction(async (tx) => {
          await assertGeneralStudioAudioProject(tx, access.organisation.id, projectId);
          const sourceIds = [...new Set(saved.clean.clips.filter((clip) => clip.kind === "SOURCE").map((clip) => clip.mediaAssetId))];
          const usable = await generalStudioMediaAssetIds(tx, access.organisation.id, sourceIds);
          if (usable.size !== sourceIds.length) throw Object.assign(new Error("One or more clip sources are not available in general Studio."), { status: 403 });
          await tx.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: parsed.data.preset } });
          await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "AUDIO_RENDER_QUEUED", entityType: "AudioProject", entityId: projectId, details: { version: saved.version.version, preset: parsed.data.preset } } });
        });
      } else if (cleanupPreviewRequested) {
        const groupId = crypto.randomUUID();
        await prisma.$transaction(async (tx) => {
          await assertGeneralStudioAudioProject(tx, access.organisation.id, projectId);
          const sourceIds = [...new Set(saved.clean.clips.filter((clip) => clip.kind === "SOURCE").map((clip) => clip.mediaAssetId))];
          const usable = await generalStudioMediaAssetIds(tx, access.organisation.id, sourceIds);
          if (usable.size !== sourceIds.length) throw Object.assign(new Error("One or more clip sources are not available in general Studio."), { status: 403 });
          await tx.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: "SPEECH_MP3", resultJson: { studioPreview: { groupId, purpose: "VOICE_CLEANUP", variant: "BEFORE" } } } });
          await tx.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: "SPEECH_MP3", resultJson: { studioPreview: { groupId, purpose: "VOICE_CLEANUP", variant: "AFTER" } } } });
          await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "VOICE_CLEANUP_PREVIEW_QUEUED", entityType: "AudioProject", entityId: projectId, details: { version: saved.version.version, groupId, variants: ["BEFORE", "AFTER"] } } });
        });
      } else if (masterPreviewRequested) {
        const groupId = crypto.randomUUID();
        await prisma.$transaction(async (tx) => {
          await assertGeneralStudioAudioProject(tx, access.organisation.id, projectId);
          const sourceIds = [...new Set(saved.clean.clips.filter((clip) => clip.kind === "SOURCE").map((clip) => clip.mediaAssetId))];
          const usable = await generalStudioMediaAssetIds(tx, access.organisation.id, sourceIds);
          if (usable.size !== sourceIds.length) throw Object.assign(new Error("One or more clip sources are not available in general Studio."), { status: 403 });
          await tx.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: "SPEECH_MP3", resultJson: { studioPreview: { groupId, purpose: "EFFECTS_MASTERING", variant: "MASTER" } } } });
          await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "STUDIO_MASTER_PREVIEW_QUEUED", entityType: "AudioProject", entityId: projectId, details: { version: saved.version.version, groupId, effectsPreset: saved.clean.effects.preset, masteringPreset: saved.clean.mastering.preset } } });
        });
      }
    }
    await assertGeneralStudioAudioProject(prisma, access.organisation.id, projectId);
    const updated = await prisma.audioProject.findFirst({
      where: { id: projectId, organisationId: access.organisation.id, status: { not: "ARCHIVED" }, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE },
      include: studioWaveformEditorInclude
    });
    if (!updated) throw Object.assign(new Error("The AudioLab project is unavailable in general Studio."), { status: 403 });
    await assertGeneralWaveformProjectMedia(prisma, access.organisation.id, updated);
    return NextResponse.json(serializeStudioWaveformProject(updated, access.entitlements));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The waveform project could not be saved." }, { status: error?.status || 409 });
  }
}


