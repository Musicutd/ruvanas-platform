export const RADIO_SYNDICATION_POLICY_VERSION = "radio-syndication-v1";
export const RADIO_SYNDICATION_KINDS = Object.freeze(["RECORDED_PROGRAMME", "LIVE_RELAY"]);
export const RADIO_SYNDICATION_MANAGER_ROLES = Object.freeze(["OWNER", "MANAGER"]);

const OFFER_TRANSITIONS = Object.freeze({
  PUBLISH: new Set(["DRAFT", "PAUSED"]),
  PAUSE: new Set(["AVAILABLE"]),
  WITHDRAW: new Set(["DRAFT", "AVAILABLE", "PAUSED"])
});

const AGREEMENT_TRANSITIONS = Object.freeze({
  APPROVE: new Set(["PENDING"]),
  DECLINE: new Set(["PENDING"]),
  CANCEL: new Set(["PENDING"]),
  REVOKE: new Set(["APPROVED"])
});

function boundedText(value, label, maximum, { required = false, minimum = 0 } = {}) {
  const result = String(value || "").trim().replace(/\s+/g, " ");
  if (required && result.length < Math.max(1, minimum)) throw new Error(`${label} is required${minimum > 1 ? ` and must be at least ${minimum} characters` : ""}.`);
  if (result.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return result || null;
}

function validInstant(value, label, { required = false } = {}) {
  if (!value && !required) return null;
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return result;
}

export function canManageRadioSyndication(role) {
  return RADIO_SYNDICATION_MANAGER_ROLES.includes(String(role || "").toUpperCase());
}

export function normalizeRadioSyndicationTerritories(value) {
  const entries = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  const normalized = [...new Set(entries.map((entry) => String(entry || "").trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length) throw new Error("Choose at least one permitted territory or WORLDWIDE.");
  if (normalized.includes("WORLDWIDE")) {
    if (normalized.length !== 1) throw new Error("WORLDWIDE cannot be combined with individual territories.");
    return "WORLDWIDE";
  }
  if (normalized.some((entry) => !/^[A-Z]{2}$/.test(entry))) throw new Error("Territories must use two-letter country codes or WORLDWIDE.");
  return normalized.sort().join(",");
}

export function radioSyndicationTerritorySet(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "WORLDWIDE" ? new Set(["WORLDWIDE"]) : new Set(normalized.split(",").filter((entry) => /^[A-Z]{2}$/.test(entry)));
}

export function normalizeRadioSyndicationOffer(input = {}) {
  const kind = String(input.kind || "").trim().toUpperCase();
  if (!RADIO_SYNDICATION_KINDS.includes(kind)) throw new Error("Choose a recorded programme or live relay.");
  const availableFrom = validInstant(input.availableFrom, "Rights start", { required: true });
  const availableUntil = validInstant(input.availableUntil, "Rights end");
  if (availableUntil && availableUntil <= availableFrom) throw new Error("Rights end must be later than rights start.");
  if (availableUntil && availableUntil.getTime() - availableFrom.getTime() > 366 * 24 * 60 * 60 * 1000) throw new Error("A syndication rights window cannot exceed 366 days.");
  const sourcePodcastEpisodeId = boundedText(input.sourcePodcastEpisodeId, "Recorded programme", 64);
  const sourceChannelId = boundedText(input.sourceChannelId, "Live channel", 64);
  if (kind === "RECORDED_PROGRAMME" && (!sourcePodcastEpisodeId || sourceChannelId)) throw new Error("Choose exactly one published recorded programme.");
  if (kind === "LIVE_RELAY" && (!sourceChannelId || sourcePodcastEpisodeId)) throw new Error("Choose exactly one active live channel.");
  const rightsBasis = String(input.rightsBasis || "").trim().toUpperCase();
  if (!new Set(["OWNED_MASTER", "DIRECT_LICENCE", "DISTRIBUTOR_LICENCE", "OTHER"]).has(rightsBasis)) throw new Error("Choose the legal basis for syndication rights.");
  return {
    stationNetworkId: boundedText(input.stationNetworkId, "Station network", 64, { required: true }),
    sourceStationId: boundedText(input.sourceStationId, "Source station", 64, { required: true }),
    sourcePodcastEpisodeId,
    sourceChannelId,
    kind,
    title: boundedText(input.title, "Offer title", 140, { required: true }),
    description: boundedText(input.description, "Description", 1000),
    rightsHolder: boundedText(input.rightsHolder, "Rights holder", 160, { required: true }),
    rightsReference: boundedText(input.rightsReference, "Rights reference", 200, { required: true }),
    rightsBasis,
    permittedTerritories: normalizeRadioSyndicationTerritories(input.permittedTerritories),
    availableFrom,
    availableUntil
  };
}

export function normalizeRadioSyndicationRequest(input = {}, offer) {
  const requestedFrom = validInstant(input.requestedFrom, "Requested start", { required: true });
  const requestedUntil = validInstant(input.requestedUntil, "Requested end");
  if (requestedUntil && requestedUntil <= requestedFrom) throw new Error("Requested end must be later than requested start.");
  if (requestedFrom < new Date(offer.availableFrom) || (offer.availableUntil && (!requestedUntil || requestedUntil > new Date(offer.availableUntil)))) {
    throw new Error("The requested window must stay within the offer's rights window.");
  }
  const permitted = radioSyndicationTerritorySet(offer.permittedTerritories);
  const requestedTerritories = normalizeRadioSyndicationTerritories(input.requestedTerritories);
  const requested = radioSyndicationTerritorySet(requestedTerritories);
  if (!permitted.has("WORLDWIDE") && (requested.has("WORLDWIDE") || [...requested].some((code) => !permitted.has(code)))) {
    throw new Error("Requested territories must be a subset of the offer's permitted territories.");
  }
  return {
    targetStationId: boundedText(input.targetStationId, "Receiving station", 64, { required: true }),
    targetChannelId: boundedText(input.targetChannelId, "Receiving channel", 64),
    requestedTerritories,
    requestedFrom,
    requestedUntil,
    intendedUse: boundedText(input.intendedUse, "Intended use", 500, { required: true, minimum: 20 })
  };
}

export function transitionRadioSyndicationOffer({ currentStatus, action, reason }) {
  const normalizedAction = String(action || "").toUpperCase();
  if (!OFFER_TRANSITIONS[normalizedAction]?.has(currentStatus)) throw new Error("That offer action is not available in its current state.");
  const notes = boundedText(reason, "Reason", 1000);
  if (normalizedAction === "WITHDRAW" && !notes) throw new Error("A reason is required when withdrawing an offer.");
  if (normalizedAction === "PUBLISH") return { status: "AVAILABLE", publishedAt: new Date(), pausedAt: null, withdrawnAt: null, notes };
  if (normalizedAction === "PAUSE") return { status: "PAUSED", pausedAt: new Date(), notes };
  return { status: "WITHDRAWN", withdrawnAt: new Date(), notes };
}

export function transitionRadioSyndicationAgreement({ currentStatus, action, notes }) {
  const normalizedAction = String(action || "").toUpperCase();
  if (!AGREEMENT_TRANSITIONS[normalizedAction]?.has(currentStatus)) throw new Error("That syndication agreement action is not available in its current state.");
  const decisionNotes = boundedText(notes, "Decision notes", 1000);
  if (["DECLINE", "REVOKE"].includes(normalizedAction) && !decisionNotes) throw new Error("A reason is required for this decision.");
  const now = new Date();
  if (normalizedAction === "APPROVE") return { status: "APPROVED", decisionNotes, decidedAt: now, revokedAt: null };
  if (normalizedAction === "DECLINE") return { status: "DECLINED", decisionNotes, decidedAt: now, revokedAt: null };
  if (normalizedAction === "CANCEL") return { status: "CANCELLED", decisionNotes, decidedAt: now, revokedAt: null };
  return { status: "REVOKED", decisionNotes, decidedAt: now, revokedAt: now };
}

export function radioSyndicationDeliveryDecision({ offer, agreement, territory, instant = new Date() }) {
  const checks = [
    [offer?.network?.status === "ACTIVE", "NETWORK_INACTIVE"],
    [offer?.sourceNetworkAgreement?.status === "ACTIVE", "SOURCE_MEMBERSHIP_INACTIVE"],
    [agreement?.targetNetworkAgreement?.status === "ACTIVE", "TARGET_MEMBERSHIP_INACTIVE"],
    [offer?.status === "AVAILABLE", "OFFER_UNAVAILABLE"],
    [agreement?.status === "APPROVED", "AGREEMENT_UNAPPROVED"],
    [offer?.sourceStation?.status === "ACTIVE", "SOURCE_STATION_INACTIVE"],
    [agreement?.targetStation?.status === "ACTIVE", "TARGET_STATION_INACTIVE"],
    [instant >= new Date(offer?.availableFrom), "OFFER_NOT_STARTED"],
    [!offer?.availableUntil || instant < new Date(offer.availableUntil), "OFFER_EXPIRED"],
    [instant >= new Date(agreement?.requestedFrom), "AGREEMENT_NOT_STARTED"],
    [!agreement?.requestedUntil || instant < new Date(agreement.requestedUntil), "AGREEMENT_EXPIRED"]
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) return { allowed: false, reason: failed[1] };
  const requested = radioSyndicationTerritorySet(agreement.requestedTerritories);
  const territoryCode = String(territory || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(territoryCode) || (!requested.has("WORLDWIDE") && !requested.has(territoryCode))) return { allowed: false, reason: "TERRITORY_NOT_PERMITTED" };
  if (offer.kind === "RECORDED_PROGRAMME" && (!offer.sourcePodcastEpisode || offer.sourcePodcastEpisode.status !== "PUBLISHED" || offer.sourcePodcastEpisode.mediaAsset?.status !== "READY")) return { allowed: false, reason: "RECORDED_SOURCE_UNAVAILABLE" };
  if (offer.kind === "LIVE_RELAY" && (!offer.sourceChannel || offer.sourceChannel.status !== "ACTIVE" || !offer.sourceStation?.streamConfig?.streamUrl)) return { allowed: false, reason: "LIVE_SOURCE_UNAVAILABLE" };
  return { allowed: true, reason: "DELIVERABLE" };
}

export function redactedRadioSyndicationOffer(offer, { activeOrganisationId } = {}) {
  const ownOffer = offer.sourceOrganisationId === activeOrganisationId;
  return {
    id: offer.id,
    kind: offer.kind,
    title: offer.title,
    description: offer.description,
    status: offer.status,
    rightsHolder: offer.rightsHolder,
    rightsBasis: offer.rightsBasis,
    rightsReference: ownOffer ? offer.rightsReference : "Verified by source station",
    permittedTerritories: offer.permittedTerritories,
    availableFrom: offer.availableFrom,
    availableUntil: offer.availableUntil,
    termsVersion: offer.termsVersion,
    ownOffer,
    network: { id: offer.network.id, name: offer.network.name },
    sourceStation: { id: offer.sourceStation.id, name: offer.sourceStation.name, slug: offer.sourceStation.slug },
    sourceOrganisation: { id: offer.sourceOrganisation.id, name: offer.sourceOrganisation.name },
    agreements: ownOffer ? (offer.agreements || []).map(redactedRadioSyndicationAgreement) : []
  };
}

export function redactedRadioSyndicationAgreement(agreement) {
  return {
    id: agreement.id,
    offerId: agreement.offerId,
    status: agreement.status,
    targetStation: { id: agreement.targetStation.id, name: agreement.targetStation.name },
    targetOrganisation: { id: agreement.targetOrganisation.id, name: agreement.targetOrganisation.name },
    targetChannel: agreement.targetChannel ? { id: agreement.targetChannel.id, name: agreement.targetChannel.name } : null,
    requestedTerritories: agreement.requestedTerritories,
    requestedFrom: agreement.requestedFrom,
    requestedUntil: agreement.requestedUntil,
    intendedUse: agreement.intendedUse,
    decisionNotes: agreement.decisionNotes,
    requestedAt: agreement.requestedAt,
    importedAt: agreement.importedAt
  };
}

export function radioSyndicationFleetSummary(offers = []) {
  return offers.reduce((summary, offer) => {
    summary.offers += 1;
    summary.recorded += offer.kind === "RECORDED_PROGRAMME" ? 1 : 0;
    summary.live += offer.kind === "LIVE_RELAY" ? 1 : 0;
    for (const agreement of offer.agreements || []) {
      summary.agreements += 1;
      if (agreement.status === "APPROVED") summary.approved += 1;
    }
    return summary;
  }, { offers: 0, recorded: 0, live: 0, agreements: 0, approved: 0 });
}
