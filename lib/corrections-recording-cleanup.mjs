const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const UUID_AUDIO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|wav|ogg|m4a|webm)$/i;

// The recording write holds this project row before it creates a READY media
// reference. Wait on the same lock after an ambiguous commit result, then read
// the exact key. Missing project, invalid scope or database failure must never
// turn into permission to delete private Corrections evidence.
export async function canDeleteUncommittedCorrectionsRecording(database, {
  organisationId, projectId, storageKey
}) {
  if (!SAFE_ID.test(organisationId || "") || !SAFE_ID.test(projectId || "") ||
    typeof storageKey !== "string" || !storageKey.startsWith(
      `organisations/${organisationId}/corrections-studio/${projectId}/`
    ) || !UUID_AUDIO.test(storageKey.split("/").at(-1)) || storageKey.split("/").length !== 5) return false;

  return database.$transaction(async (tx) => {
    const projects = await tx.$queryRaw`SELECT "id" FROM "AudioProject"
      WHERE "id" = ${projectId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (projects.length !== 1) return false;
    // Global and status-agnostic: even a malformed cross-tenant or DELETED
    // row is stronger evidence than an unconfirmed upload error.
    const reference = await tx.mediaAsset.findUnique({
      where: { storageKey }, select: { id: true }
    });
    return !reference;
  }, { isolationLevel: "ReadCommitted" });
}
