export async function invalidateApprovedAudioOutputs(tx, projectId) {
  const approved = await tx.audioRender.findMany({
    where: { projectId, outputPromoVersion: { is: { status: "APPROVED" } } },
    select: { outputPromoVersionId: true }
  });
  const versionIds = approved.map((item) => item.outputPromoVersionId).filter(Boolean);
  if (!versionIds.length) return 0;
  await tx.promoVersion.updateMany({ where: { id: { in: versionIds } }, data: { status: "SUPERSEDED" } });
  await tx.promoAsset.updateMany({ where: { currentApprovedVersionId: { in: versionIds } }, data: { currentApprovedVersionId: null } });
  return versionIds.length;
}
