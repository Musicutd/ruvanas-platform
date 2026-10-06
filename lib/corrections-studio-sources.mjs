export function correctionsStudioSourceIds(versionState) {
  const editor = Array.isArray(versionState?.editor?.clips) ? versionState.editor.clips : [];
  const mixer = Array.isArray(versionState?.multitrack?.tracks)
    ? versionState.multitrack.tracks.flatMap((track) => Array.isArray(track.clips) ? track.clips : []) : [];
  return [...new Set([...editor, ...mixer].filter((clip) => clip.kind === "SOURCE" && typeof clip.mediaAssetId === "string").map((clip) => clip.mediaAssetId))];
}

export function correctionsStudioSourcesCurrent(sourceIds, takes, { requireCurrentVersion = true } = {}) {
  return sourceIds.every((id) => takes.some((take) => {
    if (take.mediaAssetId !== id) return false;
    if (!take || take.status !== "READY" || take.trashedAt || take.mediaAsset?.status !== "READY") return false;
    const version = take.promoVersion;
    return !version || (version.status === "APPROVED" && version.qcStatus === "PASSED" &&
      version.promoAsset?.status === "ACTIVE" && (!requireCurrentVersion || version.promoAsset.currentApprovedVersionId === version.id));
  }));
}

export const correctionsStudioSourceTakeSelect = {
  id: true, mediaAssetId: true, durationMs: true, status: true, trashedAt: true,
  mediaAsset: { select: { durationSeconds: true, status: true } },
  promoVersion: { select: { id: true, status: true, qcStatus: true,
    promoAsset: { select: { status: true, currentApprovedVersionId: true } } } }
};

export function correctionsStudioCurrentTakes(takes) {
  return takes.filter((take) => correctionsStudioSourcesCurrent([take.mediaAssetId], [take]));
}
