import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveStudio } from "@/lib/studio-access";
import { assertStudioWaveformWriteAllowed, normalizeEditorState } from "@/lib/waveform-editor.mjs";
import { normalizeVoiceCleanup } from "@/lib/voice-cleanup.mjs";
import { applyStudioMasteringPreset, normalizeStudioEffects, normalizeStudioMastering } from "@/lib/studio-effects-mastering.mjs";
import { findStudioWaveformProject, saveStudioWaveformSnapshot, serializeStudioWaveformProject } from "@/lib/studio-waveform-persistence";

export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("INITIALIZE"), takeId: z.string().cuid() }),
  z.object({ action: z.literal("SAVE"), state: z.record(z.unknown()), reason: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("QUEUE_RENDER"), state: z.record(z.unknown()), preset: z.enum(["SCHOOL_RADIO_MP3", "SPEECH_MP3", "WAV_MASTER"]) }),
  z.object({ action: z.literal("QUEUE_CLEANUP_PREVIEW"), state: z.record(z.unknown()) }),
  z.object({ action: z.literal("QUEUE_MASTER_PREVIEW"), state: z.record(z.unknown()) })
]);

export async function GET(_request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const project = await findStudioWaveformProject((await params).projectId, access.organisation.id);
  if (!project) return NextResponse.json({ error: "The AudioLab project was not found." }, { status: 404 });
  return NextResponse.json(serializeStudioWaveformProject(project, access.entitlements));
}

export async function POST(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The waveform editor request is invalid." }, { status: 400 });
  const projectId = (await params).projectId;
  const project = await prisma.audioProject.findFirst({ where: { id: projectId, organisationId: access.organisation.id, status: { not: "ARCHIVED" } } });
  if (!project) return NextResponse.json({ error: "The AudioLab project was not found." }, { status: 404 });
  try {
    if (parsed.data.action === "INITIALIZE") {
      const take = await prisma.audioTake.findFirst({ where: { id: parsed.data.takeId, projectId, organisationId: access.organisation.id, status: { in: ["READY", "PROCESSING"] }, trashedAt: null }, include: { mediaAsset: true } });
      if (!take) return NextResponse.json({ error: "Choose an available source take from this project." }, { status: 404 });
      const durationMs = take.durationMs || (take.mediaAsset.durationSeconds ? take.mediaAsset.durationSeconds * 1000 : 0);
      if (!durationMs) return NextResponse.json({ error: "This take is still being analysed. Try again shortly." }, { status: 409 });
      const state = { clips: [{ clientId: `take-${take.id}`, kind: "SOURCE", mediaAssetId: take.mediaAssetId, sourceStartMs: 0, sourceEndMs: durationMs, timelineStartMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 0, fadeInCurve: "linear", fadeOutCurve: "linear", locked: false }], markers: [], normalize: true, targetLufs: -16, noiseCleanup: false, voiceCleanup: normalizeVoiceCleanup(), effects: normalizeStudioEffects(), mastering: applyStudioMasteringPreset("PODCAST") };
      await prisma.$transaction((tx) => saveStudioWaveformSnapshot(tx, { project, userId: access.user.id, state, reason: "Waveform editor initialized" }));
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
      const saved = await prisma.$transaction((tx) => saveStudioWaveformSnapshot(tx, { project, userId: access.user.id, state: requestedState, reason: renderRequested ? "Final render requested" : cleanupPreviewRequested ? "Voice cleanup comparison requested" : masterPreviewRequested ? "Effects and mastering preview requested" : parsed.data.reason || "Waveform editor save" }));
      if (parsed.data.action === "QUEUE_RENDER") {
        await prisma.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: parsed.data.preset } });
        await prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "AUDIO_RENDER_QUEUED", entityType: "AudioProject", entityId: projectId, details: { version: saved.version.version, preset: parsed.data.preset } } });
      } else if (cleanupPreviewRequested) {
        const groupId = crypto.randomUUID();
        await prisma.$transaction([
          prisma.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: "SPEECH_MP3", resultJson: { studioPreview: { groupId, purpose: "VOICE_CLEANUP", variant: "BEFORE" } } } }),
          prisma.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: "SPEECH_MP3", resultJson: { studioPreview: { groupId, purpose: "VOICE_CLEANUP", variant: "AFTER" } } } }),
          prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "VOICE_CLEANUP_PREVIEW_QUEUED", entityType: "AudioProject", entityId: projectId, details: { version: saved.version.version, groupId, variants: ["BEFORE", "AFTER"] } } })
        ]);
      } else if (masterPreviewRequested) {
        const groupId = crypto.randomUUID();
        await prisma.$transaction([
          prisma.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: "SPEECH_MP3", resultJson: { studioPreview: { groupId, purpose: "EFFECTS_MASTERING", variant: "MASTER" } } } }),
          prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "STUDIO_MASTER_PREVIEW_QUEUED", entityType: "AudioProject", entityId: projectId, details: { version: saved.version.version, groupId, effectsPreset: saved.clean.effects.preset, masteringPreset: saved.clean.mastering.preset } } })
        ]);
      }
    }
    const updated = await findStudioWaveformProject(projectId, access.organisation.id);
    return NextResponse.json(serializeStudioWaveformProject(updated, access.entitlements));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The waveform project could not be saved." }, { status: 409 });
  }
}


