import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentCorrectionsContributorSession } from "@/lib/corrections-contributor-auth";
import { studioMultitrackTrackLimit } from "@/lib/multitrack-studio.mjs";
import { correctionsStudioCurrentTakes, correctionsStudioSourceTakeSelect } from "@/lib/corrections-studio-sources.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await currentCorrectionsContributorSession("EDIT");
  if (!access || access.session.project.type !== "MULTITRACK" || !access.entitlements.studioProEnabled) return NextResponse.json({ error: "This supervised mixer is unavailable." }, { status: 403 });
  const takes = correctionsStudioCurrentTakes(await prisma.audioTake.findMany({
    where: { projectId: access.session.projectId, organisationId: access.session.organisationId },
    orderBy: { createdAt: "desc" }, select: { ...correctionsStudioSourceTakeSelect, waveformPeaks: true,
      mediaAsset: { select: { ...correctionsStudioSourceTakeSelect.mediaAsset.select,
        id: true, name: true, mimeType: true, mediaType: true, libraryType: true } } }
  }));
  return NextResponse.json({ projects: [{ id: access.session.projectId, title: access.session.project.title,
    currentVersion: access.session.project.currentVersion }], programmes: [], episodes: [], groups: [], canApprove: false,
    sources: takes.map((take) => ({ ...take.mediaAsset, label: take.mediaAsset.name, sourceType: "TAKE",
      durationMs: take.durationMs || (take.mediaAsset.durationSeconds || 0) * 1000, waveformPeaks: take.waveformPeaks })),
    studioLevel: access.entitlements.studioLevel, studioProEnabled: access.entitlements.studioProEnabled,
    trackLimit: studioMultitrackTrackLimit(access.entitlements), planName: access.entitlements.planName },
    { headers: { "Cache-Control": "private, no-store" } });
}
