import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentCorrectionsContributorSession, sameOrigin } from "@/lib/corrections-contributor-auth";
import { findStudioWaveformProject, saveStudioWaveformSnapshot, serializeStudioWaveformProject } from "@/lib/studio-waveform-persistence";
import { assertStudioWaveformWriteAllowed, normalizeEditorState } from "@/lib/waveform-editor.mjs";
import { applyStudioMasteringPreset, normalizeStudioEffects } from "@/lib/studio-effects-mastering.mjs";
import { normalizeVoiceCleanup } from "@/lib/voice-cleanup.mjs";

export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("INITIALIZE"), takeId: z.string().cuid() }),
  z.object({ action: z.literal("SAVE"), state: z.record(z.unknown()), reason: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("QUEUE_RENDER"), state: z.record(z.unknown()), preset: z.enum(["SCHOOL_RADIO_MP3", "SPEECH_MP3"]) }),
  z.object({ action: z.literal("QUEUE_CLEANUP_PREVIEW"), state: z.record(z.unknown()) }),
  z.object({ action: z.literal("QUEUE_MASTER_PREVIEW"), state: z.record(z.unknown()) })
]);

function response(project, entitlements) {
  const serialized = serializeStudioWaveformProject(project, entitlements, { restrictedMediaPath: "/api/corrections/contributor/media" });
  return NextResponse.json(serialized, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request, { params }) {
  const access = await currentCorrectionsContributorSession("EDIT");
  if (!access) return NextResponse.json({ error: "Your supervised Studio session is unavailable." }, { status: 403 });
  const projectId = (await params).projectId;
  if (projectId !== access.session.projectId) return NextResponse.json({ error: "Project unavailable." }, { status: 404 });
  const project = await findStudioWaveformProject(projectId, access.session.organisationId);
  return project ? response(project, access.entitlements) : NextResponse.json({ error: "Project unavailable." }, { status: 404 });
}

export async function POST(request, { params }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await currentCorrectionsContributorSession("EDIT");
  if (!access) return NextResponse.json({ error: "Your supervised Studio session is unavailable." }, { status: 403 });
  const projectId = (await params).projectId;
  if (projectId !== access.session.projectId) return NextResponse.json({ error: "Project unavailable." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The Studio edit request is invalid." }, { status: 400 });
  if (["QUEUE_RENDER", "QUEUE_CLEANUP_PREVIEW", "QUEUE_MASTER_PREVIEW"].includes(parsed.data.action) && !access.session.capabilityScope.includes("RENDER")) return NextResponse.json({ error: "Rendering is not available in this session." }, { status: 403 });
  try {
    await prisma.$transaction(async (tx) => {
      const session = await tx.correctionsStudioSession.findFirst({ where: { id: access.session.id, status: "ACTIVE", accessTokenHash: access.session.accessTokenHash, expiresAt: { gt: new Date() }, contributor: { status: "ACTIVE" }, programme: { status: { in: ["DRAFT", "CHANGES_REQUESTED", "REJECTED"] } } } });
      if (!session) throw new Error("Your supervised Studio session has ended.");
      const project = await tx.audioProject.findFirst({ where: { id: projectId, organisationId: session.organisationId, status: { not: "ARCHIVED" } } });
      if (!project || project.type !== "QUICK_RECORD") throw new Error("The assigned Studio project is unavailable.");
      const takes = await tx.audioTake.findMany({ where: { projectId, organisationId: session.organisationId, status: { in: ["READY", "PROCESSING"] }, trashedAt: null }, select: { id: true, mediaAssetId: true, durationMs: true, mediaAsset: { select: { durationSeconds: true } } } });
      const allowedSourceIds = new Set(takes.map((take) => take.mediaAssetId));
      let state;
      if (parsed.data.action === "INITIALIZE") {
        const take = takes.find((item) => item.id === parsed.data.takeId);
        if (!take) throw new Error("Choose a recording from this supervised project.");
        const durationMs = take.durationMs || (take.mediaAsset.durationSeconds || 0) * 1000;
        if (!durationMs) throw new Error("The recording is still being analysed.");
        state = { clips: [{ clientId: `take-${take.id}`, kind: "SOURCE", mediaAssetId: take.mediaAssetId, sourceStartMs: 0, sourceEndMs: durationMs, timelineStartMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 0, fadeInCurve: "linear", fadeOutCurve: "linear", locked: false }], markers: [], normalize: true, targetLufs: -16, noiseCleanup: false, voiceCleanup: normalizeVoiceCleanup(), effects: normalizeStudioEffects(), mastering: applyStudioMasteringPreset("PODCAST") };
      } else state = normalizeEditorState(parsed.data.state);
      assertStudioWaveformWriteAllowed(state, access.entitlements);
      if (!state.clips.length && parsed.data.action !== "SAVE") throw new Error("Record or select audio before rendering.");
      const renderRequested = parsed.data.action === "QUEUE_RENDER";
      const previewRequested = ["QUEUE_CLEANUP_PREVIEW", "QUEUE_MASTER_PREVIEW"].includes(parsed.data.action);
      const saved = await saveStudioWaveformSnapshot(tx, { project, userId: session.supervisorUserId, state, reason: renderRequested ? "Corrections supervised render requested" : previewRequested ? "Corrections supervised preview requested" : parsed.data.reason || "Corrections supervised edit", allowedSourceIds });
      if (renderRequested || previewRequested) {
        const preview = previewRequested ? { studioPreview: { groupId: crypto.randomUUID(), purpose: parsed.data.action === "QUEUE_CLEANUP_PREVIEW" ? "VOICE_CLEANUP" : "EFFECTS_MASTERING", variant: "MASTER" } } : undefined;
        await tx.audioRender.create({ data: { organisationId: session.organisationId, projectId, versionId: saved.version.id, requestedByUserId: session.supervisorUserId, preset: renderRequested ? parsed.data.preset : "SPEECH_MP3", ...(preview ? { resultJson: preview } : {}) } });
      }
      await tx.auditLog.create({ data: { organisationId: session.organisationId, action: renderRequested ? "CORRECTIONS_STUDIO_RENDER_QUEUED" : "CORRECTIONS_STUDIO_EDIT_SAVED", entityType: "CorrectionsStudioSession", entityId: session.id, details: { facilityId: session.facilityId, contributorId: session.contributorId, projectId, versionId: saved.version.id } } });
    });
    const updated = await findStudioWaveformProject(projectId, access.session.organisationId);
    return response(updated, access.entitlements);
  } catch (error) { return NextResponse.json({ error: error.message || "The supervised edit could not be saved." }, { status: 409 }); }
}
