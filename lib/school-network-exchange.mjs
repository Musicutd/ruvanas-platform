export const SCHOOL_NETWORK_EXCHANGE_POLICY_VERSION = "school-network-exchange-v1";

const OFFER_TRANSITIONS = Object.freeze({
  PAUSE: new Set(["AVAILABLE"]),
  RESUME: new Set(["PAUSED"]),
  WITHDRAW: new Set(["AVAILABLE", "PAUSED"])
});

const REQUEST_TRANSITIONS = Object.freeze({
  APPROVE: new Set(["PENDING"]),
  DECLINE: new Set(["PENDING"]),
  CANCEL: new Set(["PENDING"]),
  REVOKE: new Set(["APPROVED"])
});

function cleanText(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function consentIsCurrent(record, instant) {
  return Boolean(record && record.status === "GRANTED" && (!record.expiresAt || new Date(record.expiresAt) > instant) && !record.revokedAt);
}

export function normaliseSchoolExchangeIntendedUse(value) {
  const intendedUse = cleanText(value, 500);
  if (intendedUse.length < 20) throw new Error("Describe how the receiving school plans to use this episode.");
  return intendedUse;
}

export function validateSchoolEpisodeExchangeEligibility({
  episodeStatus,
  promoVersionStatus,
  promoAssetStatus,
  contributorIds = [],
  consentRecords = [],
  consentConfirmed = false,
  instant = new Date()
}) {
  if (episodeStatus !== "APPROVED") throw new Error("Only a staff-approved episode can be offered to another school.");
  if (!new Set(["APPROVED", "SUPERSEDED"]).has(promoVersionStatus) || promoAssetStatus !== "ACTIVE") {
    throw new Error("The episode needs an approved, active audio master before it can be shared.");
  }
  if (!consentConfirmed) throw new Error("A staff member must confirm the cross-school sharing and safeguarding checks.");
  const required = new Set(contributorIds.filter(Boolean));
  if (required.size) {
    const current = new Set(consentRecords.filter((record) => consentIsCurrent(record, instant)).map((record) => record.contributorId));
    if ([...required].some((contributorId) => !current.has(contributorId))) {
      throw new Error("Every student contributor needs a current consent record before cross-school sharing.");
    }
  }
  return { policyVersion: SCHOOL_NETWORK_EXCHANGE_POLICY_VERSION, consentConfirmed: true };
}

export function transitionSchoolExchangeOffer({ currentStatus, action, reason = null }) {
  if (!OFFER_TRANSITIONS[action]?.has(currentStatus)) {
    throw new Error(`A ${String(currentStatus).toLowerCase()} offer cannot use ${String(action).toLowerCase()}.`);
  }
  const cleanReason = cleanText(reason, 1000) || null;
  if (action === "WITHDRAW" && !cleanReason) throw new Error("A reason is required when withdrawing an episode offer.");
  if (action === "PAUSE") return { status: "PAUSED", withdrawnAt: null, reason: cleanReason };
  if (action === "RESUME") return { status: "AVAILABLE", availableAt: new Date(), withdrawnAt: null, reason: cleanReason };
  return { status: "WITHDRAWN", withdrawnAt: new Date(), reason: cleanReason };
}

export function transitionSchoolExchangeRequest({ currentStatus, action, notes = null }) {
  if (!REQUEST_TRANSITIONS[action]?.has(currentStatus)) {
    throw new Error(`A ${String(currentStatus).toLowerCase()} request cannot use ${String(action).toLowerCase()}.`);
  }
  const decisionNotes = cleanText(notes, 1000) || null;
  if (new Set(["DECLINE", "REVOKE"]).has(action) && !decisionNotes) {
    throw new Error("A reason is required for this decision.");
  }
  if (action === "APPROVE") return { status: "APPROVED", decisionNotes, decidedAt: new Date(), revokedAt: null };
  if (action === "DECLINE") return { status: "DECLINED", decisionNotes, decidedAt: new Date(), revokedAt: null };
  if (action === "CANCEL") return { status: "CANCELLED", decisionNotes, decidedAt: new Date(), revokedAt: null };
  return { status: "REVOKED", decisionNotes, decidedAt: new Date(), revokedAt: new Date() };
}

export function importedExchangeIsPlayable(announcement, targetOrganisationId) {
  const request = announcement?.sourceExchangeRequest;
  if (!request) return true;
  return Boolean(
    request.targetOrganisationId === targetOrganisationId &&
    request.status === "APPROVED" &&
    request.offer?.status === "AVAILABLE"
  );
}

export function redactedSchoolExchangeOffer(offer, { activeOrganisationId }) {
  const ownOffer = offer.sourceOrganisationId === activeOrganisationId;
  return {
    id: offer.id,
    sourceSchool: { id: offer.sourceOrganisation.id, name: offer.sourceOrganisation.name },
    title: offer.sourceTitle,
    summary: offer.sourceSummary,
    languageCode: offer.languageCode,
    durationSeconds: offer.durationSeconds,
    status: offer.status,
    availableAt: offer.availableAt,
    ownOffer,
    policyVersion: offer.policyVersion,
    requests: ownOffer
      ? (offer.requests || []).map((request) => ({
          id: request.id,
          targetSchool: { id: request.targetOrganisation.id, name: request.targetOrganisation.name },
          status: request.status,
          intendedUse: request.intendedUse,
          decisionNotes: request.decisionNotes,
          requestedAt: request.requestedAt,
          imported: Boolean(request.importedAnnouncement)
        }))
      : []
  };
}
