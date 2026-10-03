import { correctionsStudioSourceIds } from "./corrections-studio-sources.mjs";

// The ordinary AudioLab permanent-delete path locks this same project row
// through its final object-store cleanup. A staff render-only submission must
// not make the project private in Corrections Guard while that cleanup runs.
export async function lockCorrectionsStaffRenderSources(tx, { organisationId, render }) {
  if (!render?.projectId || render.organisationId !== organisationId) {
    throw new Error("Choose a Studio render from this organisation.");
  }
  const sourceIds = correctionsStudioSourceIds(render.version?.state);
  const media = sourceIds.length ? await tx.mediaAsset.findMany({
    where: { id: { in: sourceIds }, OR: [
      { organisationId }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }
    ] },
    select: { id: true, status: true }
  }) : [];
  const takes = await tx.audioTake.findMany({
    where: { organisationId, mediaAssetId: { in: sourceIds } },
    select: { id: true, projectId: true, mediaAssetId: true, status: true, trashedAt: true, permanentlyDeletedAt: true,
      mediaAsset: { select: { status: true } } }
  });
  const projectIds = [...new Set([render.projectId, ...takes.map((take) => take.projectId)])].sort();
  for (const projectId of projectIds) {
    const projects = await tx.$queryRaw`SELECT id FROM "AudioProject" WHERE id = ${projectId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (!projects.length) throw new Error("A Studio source project is unavailable.");
  }
  // Project, media and take locks follow AudioLab's deletion order. Media
  // without an AudioTake is valid in ordinary Studio, but missing/deleted
  // media is never valid evidence for a new Corrections submission.
  for (const mediaAssetId of [...sourceIds].sort()) {
    const locked = await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id = ${mediaAssetId} FOR UPDATE`;
    if (!locked.length) throw new Error("A source for this Studio render is no longer available. Create a new render before submitting.");
  }
  for (const take of [...takes].sort((a, b) => a.id.localeCompare(b.id))) {
    await tx.$queryRaw`SELECT id FROM "AudioTake" WHERE id = ${take.id} FOR UPDATE`;
  }
  if (media.length !== sourceIds.length || media.some((asset) => asset.status !== "READY")) {
    throw new Error("A source for this Studio render is no longer available. Create a new render before submitting.");
  }
  for (const take of takes) {
    // FOR UPDATE detects a deletion committed since this serializable
    // transaction's snapshot; the caller retries and sees the tombstone.
    if (take.status !== "READY" || take.trashedAt || take.permanentlyDeletedAt || take.mediaAsset?.status !== "READY") {
      throw new Error("A source recording for this Studio render is no longer available. Create a new render before submitting.");
    }
  }
}
