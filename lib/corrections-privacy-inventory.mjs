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
  const counts = await Promise.all([
    database.correctionsContributor.count({ where: { organisationId: organisation } }),
    database.correctionsStudioSession.count({ where: { organisationId: organisation } }),
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
    database.auditLog.count({ where: { organisationId: organisation, action: { startsWith: "CORRECTIONS_" } } })
  ]);

  return Object.fromEntries([
    "contributors", "supervisedSessions", "submittedVersions", "reviews",
    "familyRequests", "internalRequests", "requestDecisions", "developmentMilestones",
    "rehabilitationContent", "announcements", "priorityOverrides",
    "insidePlaybackProofEvents", "insideCompletedProofEvents", "correctionsAuditEvents"
  ].map((key, index) => [key, counts[index]]));
}
