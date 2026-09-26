import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentCorrectionsContributorSession } from "@/lib/corrections-contributor-auth";
import { studioMultitrackTrackLimit } from "@/lib/multitrack-studio.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await currentCorrectionsContributorSession("EDIT");
  if (!access || access.session.project.type !== "MULTITRACK" || !access.entitlements.studioProEnabled) return NextResponse.json({ error: "This supervised mixer is unavailable." }, { status: 403 });
  const takes = await prisma.audioTake.findMany({ where: { projectId: access.session.projectId, organisationId: access.session.organisationId,
    status: "READY", trashedAt: null, mediaAsset: { status: "READY" } }, orderBy: { createdAt: "desc" },
    select: { id: true, durationMs: true, waveformPeaks: true, mediaAsset: { select: { id: true, name: true,
      mimeType: true, durationSeconds: true, mediaType: true, libraryType: true } } } });
  return NextResponse.json({ projects: [{ id: access.session.projectId, title: access.session.project.title,
    currentVersion: access.session.project.currentVersion }], programmes: [], episodes: [], groups: [], canApprove: false,
    sources: takes.map((take) => ({ ...take.mediaAsset, label: take.mediaAsset.name, sourceType: "TAKE",
      durationMs: take.durationMs || (take.mediaAsset.durationSeconds || 0) * 1000, waveformPeaks: take.waveformPeaks })),
    studioLevel: access.entitlements.studioLevel, studioProEnabled: access.entitlements.studioProEnabled,
    trackLimit: studioMultitrackTrackLimit(access.entitlements), planName: access.entitlements.planName },
    { headers: { "Cache-Control": "private, no-store" } });
}
