export function correctionsEdgeEffectiveStatus(node, now = new Date()) {
  if (node.status !== "ACTIVE") return node.status;
  const seen = node.lastSeenAt ? new Date(node.lastSeenAt).getTime() : 0;
  if (!seen || new Date(now).getTime() - seen > 90_000) return "OFFLINE";
  if (node.syncStatus === "DEGRADED" || node.storageHealth === "DEGRADED" || !node.lastSuccessfulSyncAt ||
      new Date(now).getTime() - new Date(node.lastSuccessfulSyncAt).getTime() > 10 * 60_000) {
    return "DEGRADED";
  }
  return "ONLINE";
}
