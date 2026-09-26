import { correctionsStudioSourceIds, correctionsStudioSourcesCurrent } from "@/lib/corrections-studio-sources.mjs";

export async function correctionsStudioSourcesAvailable(tx, { organisationId, projectId, versionState }) {
  const sourceIds = correctionsStudioSourceIds(versionState);
  if (!sourceIds.length) return false;
  const takes = await tx.audioTake.findMany({ where: { projectId, organisationId, mediaAssetId: { in: sourceIds } },
    include: { mediaAsset: { select: { status: true } }, promoVersion: { select: { id: true, status: true, qcStatus: true,
      promoAsset: { select: { status: true, currentApprovedVersionId: true } } } } } });
  return correctionsStudioSourcesCurrent(sourceIds, takes);
}
