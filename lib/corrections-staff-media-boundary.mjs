// C3 staff handoff may reuse an approved ordinary Studio project at its own
// facility when a later, separately versioned render is submitted for review.
// It must never turn another facility's private C3 evidence into a shortcut.
// C4 supervised projects have a separate contributor/Guard submission path.
export function correctionsStaffProjectWhere(organisationId, facilityIds) {
  if (!organisationId) throw new Error("Organisation scope is required for Corrections staff media.");
  const submissionFacility = { organisationId, ...(facilityIds === null ? {} : { facilityId: { in: facilityIds } }) };
  return {
    organisationId,
    correctionsStudioSessions: { none: {} },
    correctionsSubmissions: { none: {} },
    renders: { every: { correctionsSubmissions: { every: submissionFacility } } }
  };
}

// Check every route by which an organisation asset can become private. A
// target may use it only if all of those private uses remain inside the same
// authorised facility scope. Network distributions are deliberately excluded:
// they have their own C7 approval path and must not become C3 source grants.
export function correctionsStaffMediaAssetWhere(organisationId, facilityIds, { allowSupervisedSources = false } = {}) {
  const project = correctionsStaffProjectWhere(organisationId, facilityIds);
  const directUse = { organisationId, ...(facilityIds === null ? {} : { facilityId: { in: facilityIds } }) };
  const sourceProject = allowSupervisedSources ? {
    organisationId,
    correctionsStudioSessions: { every: directUse },
    correctionsSubmissions: { every: directUse },
    renders: { every: { correctionsSubmissions: { every: directUse } } }
  } : project;
  return {
    audioTakes: { every: { project: { is: sourceProject } } },
    audioRenderOutputs: { every: { project: { is: project } } },
    promoVersions: { every: { renderedAudioVersions: { every: { project: { is: project } } } } },
    audioClips: { every: { track: { is: { project: { is: sourceProject } } } } },
    correctionsRehabContent: { every: directUse },
    correctionsAnnouncements: { every: directUse },
    correctionsNetworkAudioDistributions: { none: {} }
  };
}
