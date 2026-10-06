// A lost database commit acknowledgement must not turn error cleanup into
// deletion of a READY recording. The completion transaction locks the project
// before creating the media row, so take that same lock first and wait for any
// in-flight completion to commit or roll back. Then lock the upload session
// and check the exact final object key. If the decision cannot be proved,
// retain the object for a separate, audited storage reconciliation.
export async function canDeleteUncommittedAudioUploadObject(database, {
  sessionId, organisationId, projectId, finalKey
}) {
  return database.$transaction(async (tx) => {
    const projects = await tx.$queryRaw`SELECT "id" FROM "AudioProject"
      WHERE "id" = ${projectId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (projects.length !== 1) return false;
    const rows = await tx.$queryRaw`SELECT "id" FROM "SchoolAudioUploadSession"
      WHERE "id" = ${sessionId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (rows.length !== 1) return false;
    const session = await tx.schoolAudioUploadSession.findFirst({
      where: { id: sessionId, organisationId }, select: { status: true }
    });
    if (!session || session.status === "COMPLETED") return false;
    const committedMedia = await tx.mediaAsset.findFirst({
      // Exact storage references anywhere in this database outweigh the
      // request's tenant scope; a malformed cross-tenant row must not be lost.
      where: { storageKey: finalKey }, select: { id: true }
    });
    return !committedMedia;
  }, { isolationLevel: "ReadCommitted" });
}
