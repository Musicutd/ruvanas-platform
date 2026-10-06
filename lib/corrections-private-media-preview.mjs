// A generic organisation audio URL is only a staff preview for an exact
// Corrections submission or an explicitly facility-scoped audio use. Raw
// supervised takes, unsubmitted renders and private timeline sources must use
// the supervised Corrections route instead.
const protectedProject = {
  OR: [
    { correctionsStudioSessions: { some: {} } },
    { correctionsSubmissions: { some: {} } },
    { renders: { some: { correctionsSubmissions: { some: {} } } } }
  ]
};

export async function correctionsPrivateMediaPreviewScope(database, mediaAssetId) {
  const [take, clip, unsubmittedRender, submissions, rehabilitation, announcements, distributions] = await Promise.all([
    database.audioTake.findFirst({
      where: { mediaAssetId, project: { is: protectedProject } }, select: { id: true }
    }),
    database.audioClip.findFirst({
      where: { mediaAssetId, track: { is: { project: { is: protectedProject } } } }, select: { id: true }
    }),
    database.audioRender.findFirst({
      where: { outputMediaAssetId: mediaAssetId, project: { is: protectedProject }, correctionsSubmissions: { none: {} } },
      select: { id: true }
    }),
    database.correctionsSubmission.findMany({
      where: { render: { outputMediaAssetId: mediaAssetId } },
      select: { renderId: true, facilityId: true, evidenceSnapshot: true }
    }),
    database.correctionsRehabContent.findMany({ where: { mediaAssetId }, select: { facilityId: true } }),
    database.correctionsAnnouncement.findMany({ where: { mediaAssetId }, select: { facilityId: true } }),
    database.correctionsNetworkAudioDistribution.findMany({
      where: { mediaAssetId }, select: { sourceFacilityId: true, targetFacilityId: true }
    })
  ]);

  // A submitted render cannot launder the same asset's unsubmitted supervised
  // use into a general URL. The exact submitted evidence must still match.
  if (take || clip || unsubmittedRender || submissions.some(({ renderId, evidenceSnapshot }) =>
    evidenceSnapshot?.mediaAssetId !== mediaAssetId || evidenceSnapshot?.renderId !== renderId)) {
    return { protectedUse: true, available: false, facilityIds: [], ownerOnly: false };
  }
  if (!submissions.length && !rehabilitation.length && !announcements.length && !distributions.length) {
    return { protectedUse: false, available: false, facilityIds: [], ownerOnly: false };
  }
  const facilities = [
    ...submissions.map(({ facilityId }) => facilityId),
    ...rehabilitation.map(({ facilityId }) => facilityId),
    ...announcements.map(({ facilityId }) => facilityId),
    ...distributions.flatMap(({ sourceFacilityId, targetFacilityId }) => [sourceFacilityId, targetFacilityId].filter(Boolean))
  ];
  return {
    protectedUse: true,
    available: true,
    facilityIds: [...new Set(facilities.filter(Boolean))],
    ownerOnly: facilities.some((facilityId) => !facilityId)
  };
}
