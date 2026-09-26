export function correctionsStudioSourceIds(versionState) {
  const editor = Array.isArray(versionState?.editor?.clips) ? versionState.editor.clips : [];
  const mixer = Array.isArray(versionState?.multitrack?.tracks)
    ? versionState.multitrack.tracks.flatMap((track) => Array.isArray(track.clips) ? track.clips : []) : [];
  return [...new Set([...editor, ...mixer].filter((clip) => clip.kind === "SOURCE" && typeof clip.mediaAssetId === "string").map((clip) => clip.mediaAssetId))];
}

export function correctionsStudioSourcesCurrent(sourceIds, takes) {
  return sourceIds.every((id) => takes.some((take) => {
    if (take.mediaAssetId !== id) return false;
    if (!take || take.status !== "READY" || take.trashedAt || take.mediaAsset?.status !== "READY") return false;
    const version = take.promoVersion;
    return !version || (version.status === "APPROVED" && version.qcStatus === "PASSED" &&
      version.promoAsset?.status === "ACTIVE" && version.promoAsset.currentApprovedVersionId === version.id);
  }));
}
