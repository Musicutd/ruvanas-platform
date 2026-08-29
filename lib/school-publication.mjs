export const SCHOOL_PUBLICATION_POLICY_VERSION = "school-publication-v1";

function instant(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export function consentRecordIsCurrent(record, now = new Date()) {
  return Boolean(
    record &&
    record.status === "GRANTED" &&
    !record.revokedAt &&
    (!record.grantedAt || instant(record.grantedAt) <= now) &&
    (!record.expiresAt || instant(record.expiresAt) > now)
  );
}

export function resolvePublicationConsentCoverage({ contributorIds = [], consentRecords = [], now = new Date() } = {}) {
  const uniqueContributorIds = [...new Set(contributorIds.filter(Boolean))];
  const coverage = uniqueContributorIds.map((contributorId) => {
    const latest = consentRecords
      .filter((record) => record.contributorId === contributorId)
      .map((record, position) => ({ record, position }))
      .sort((left, right) => instant(right.record.createdAt) - instant(left.record.createdAt) || left.position - right.position)[0]?.record || null;
    return { contributorId, consentRecordId: latest?.id || null, current: consentRecordIsCurrent(latest, now) };
  });
  return {
    coverage,
    complete: coverage.every((entry) => entry.current),
    currentConsentRecordIds: coverage.filter((entry) => entry.current).map((entry) => entry.consentRecordId)
  };
}

export function validateControlledSchoolPublication({
  entitlementEnabled,
  profilePolicy,
  safeguardingStatus,
  episodeStatus,
  hasApprovedAudio,
  transcriptStatus,
  contributorIds = [],
  consentRecords = [],
  now = new Date()
} = {}) {
  if (!entitlementEnabled) throw new Error("Public School Radio publishing is not enabled for this organisation.");
  if (profilePolicy !== "PUBLIC") throw new Error("The school publishing policy must be set to public before an episode can be released.");
  if (safeguardingStatus !== "APPROVED") throw new Error("The school safeguarding pack must remain approved.");
  if (episodeStatus !== "APPROVED") throw new Error("Only a staff-approved episode can be published publicly.");
  if (!hasApprovedAudio) throw new Error("The episode needs an approved audio master before public publishing.");
  if (transcriptStatus !== "APPROVED") throw new Error("A staff-approved transcript is required before public publishing.");
  const consent = resolvePublicationConsentCoverage({ contributorIds, consentRecords, now });
  if (!consent.complete) throw new Error("Every student contributor needs current consent before public publishing.");
  return { allowed: true, scope: "PUBLIC", consentRecordIds: consent.currentConsentRecordIds };
}

export function controlledPublicationSnapshot({ organisationId, podcastEpisodeId, profilePolicy, safeguardingStatus, contributorIds = [], consentRecordIds = [], publicationRevision = 0 } = {}) {
  return Object.freeze({
    organisationId,
    podcastEpisodeId,
    profilePolicy,
    safeguardingStatus,
    contributorCount: [...new Set(contributorIds)].length,
    consentRecordIds: [...new Set(consentRecordIds)],
    publicationRevision,
    policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION
  });
}

export function redactPublicPodcastEpisode(podcast) {
  return Object.freeze({
    id: podcast.id,
    title: podcast.episode.title,
    summary: podcast.episode.summary || null,
    programme: podcast.episode.programme?.title || null,
    series: podcast.series.title,
    accessibleDescription: podcast.accessibleDescription || null,
    chapters: Array.isArray(podcast.chaptersJson) ? podcast.chaptersJson : [],
    transcript: Array.isArray(podcast.transcript?.segmentsJson)
      ? podcast.transcript.segmentsJson.map((segment) => ({
          startMs: Number(segment.startMs) || 0,
          endMs: Number(segment.endMs) || 0,
          text: String(segment.text || "")
        }))
      : [],
    publishedAt: podcast.publishedAt,
    updatedAt: podcast.updatedAt
  });
}
