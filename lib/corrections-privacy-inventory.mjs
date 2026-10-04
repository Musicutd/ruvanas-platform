// An inventory is not a retention decision: no cutoff, legal-hold inference, or
// deletion eligibility is calculated here. Never return individual records.
export async function countCorrectionsPrivacyInventory(database, organisationId) {
  if (typeof organisationId !== "string" || !organisationId.trim()) {
    throw new TypeError("A single organisation is required.");
  }

  const organisation = organisationId.trim();
  // The player API verifies and signs the CORRECTIONS_ programming source
  // before accepting proof events. Audit actions use the same prefix, but
  // that convention is an inventory aid, not a legal retention boundary.
  const insideProofWhere = { organisationId: organisation, programmingSource: { startsWith: "CORRECTIONS_" } };
  // Projects may be continued across supervised sessions. Relation filters
  // count each record once without treating a linked Studio asset as owned
  // exclusively by Corrections or eligible for deletion.
  const supervisedProjectWhere = { organisationId: organisation,
    correctionsStudioSessions: { some: { organisationId: organisation } } };
  const supervisedProjectRelation = { is: supervisedProjectWhere };
  const counts = await Promise.all([
    database.correctionsContributor.count({ where: { organisationId: organisation } }),
    database.correctionsStudioSession.count({ where: { organisationId: organisation } }),
    database.audioProject.count({ where: supervisedProjectWhere }),
    database.audioProjectVersion.count({ where: { project: supervisedProjectRelation } }),
    database.audioTake.count({ where: { organisationId: organisation, project: supervisedProjectRelation } }),
    database.audioTrack.count({ where: { project: supervisedProjectRelation } }),
    database.audioClip.count({ where: { track: { is: { project: supervisedProjectRelation } } } }),
    database.audioMarker.count({ where: { project: supervisedProjectRelation } }),
    database.audioRender.count({ where: { organisationId: organisation, project: supervisedProjectRelation } }),
    database.transcript.count({ where: { organisationId: organisation, project: supervisedProjectRelation } }),
    database.mediaAsset.count({ where: { organisationId: organisation, OR: [
      { audioTakes: { some: { organisationId: organisation, project: supervisedProjectRelation } } },
      { audioRenderOutputs: { some: { organisationId: organisation, project: supervisedProjectRelation } } },
      { audioClips: { some: { track: { is: { project: supervisedProjectRelation } } } } }
    ] } }),
    database.correctionsSubmission.count({ where: { organisationId: organisation } }),
    database.correctionsReview.count({ where: { submission: { is: { organisationId: organisation } } } }),
    database.correctionsRequest.count({ where: { organisationId: organisation, source: "FAMILY" } }),
    database.correctionsRequest.count({ where: { organisationId: organisation, source: "INTERNAL" } }),
    database.correctionsRequestDecision.count({ where: { organisationId: organisation } }),
    database.correctionsContributorMilestone.count({ where: { contributor: { is: { organisationId: organisation } } } }),
    database.correctionsRehabContent.count({ where: { organisationId: organisation } }),
    database.correctionsAnnouncement.count({ where: { organisationId: organisation } }),
    database.correctionsOverride.count({ where: { organisationId: organisation } }),
    database.proofOfPlayEvent.count({ where: insideProofWhere }),
    database.proofOfPlayEvent.count({ where: { ...insideProofWhere, eventType: "COMPLETED" } }),
    database.auditLog.count({ where: { organisationId: organisation, action: { startsWith: "CORRECTIONS_" } } }),
    database.correctionsEdgeNode.count({ where: { organisationId: organisation } }),
    database.correctionsEdgeManifest.count({ where: { node: { is: { organisationId: organisation } } } }),
    database.correctionsEdgeProofEvent.count({ where: { node: { is: { organisationId: organisation } } } })
  ]);

  return Object.fromEntries([
    "contributors", "supervisedSessions", "supervisedStudioProjects", "supervisedStudioVersions",
    "supervisedStudioTakes", "supervisedStudioTracks", "supervisedStudioClips", "supervisedStudioMarkers",
    "supervisedStudioRenders", "supervisedStudioTranscripts", "studioLinkedMediaAssets",
    "submittedVersions", "reviews",
    "familyRequests", "internalRequests", "requestDecisions", "developmentMilestones",
    "rehabilitationContent", "announcements", "priorityOverrides",
    "insidePlaybackProofEvents", "insideCompletedProofEvents", "correctionsAuditEvents",
    "edgeNodes", "edgeSignedManifests", "edgeRawProofEvents"
  ].map((key, index) => [key, counts[index]]));
}
