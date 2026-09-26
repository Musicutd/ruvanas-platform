export const CORRECTIONS_REHAB_CATEGORIES = Object.freeze([
  "Education", "Employment", "Reentry", "Life Skills", "Financial Skills", "Literacy",
  "Mental Wellbeing", "Meditation", "Physical Wellbeing", "Substance Recovery",
  "Relationships", "Parenting", "Culture", "Faith", "Motivation", "Community Services",
  "Preparing for Release", "Legal Information"
]);

export const CORRECTIONS_DEVELOPMENT_MODULES = Object.freeze([
  "Studio Introduction", "Microphone Skills", "Recording", "Interview Skills",
  "Editing Basics", "Programme Construction", "Presenting", "Advanced Editing",
  "Production", "Supervised Broadcasting"
]);

function inputError(message) { return Object.assign(new Error(message), { status: 400 }); }

const MUSIC_REASONS = Object.freeze({
  TRACK_NOT_READY: "the recording is not ready",
  MEDIA_NOT_READY: "the audio file is unavailable",
  RIGHTS_WINDOW_INACTIVE: "its licence is not currently active",
  RIGHTS_NOT_APPROVED: "its rights or territory are not approved",
  USE_NOT_PERMITTED: "its licence does not include Corrections radio",
  CATALOGUE_PLAN_REQUIRED: "this plan does not include that catalogue",
  CATALOGUE_TIER_REQUIRED: "this plan does not include that catalogue level",
  CATALOGUE_GENRE_LOCKED: "its genre is not available in this catalogue level",
  PROVIDER_TRACK_INACTIVE: "the supplier has not cleared this recording",
  CORRECTIONS_TRACK_BLOCKED: "the facility has blocked this recording",
  CORRECTIONS_ARTIST_BLOCKED: "the facility has blocked this artist",
  CORRECTIONS_GENRE_RESTRICTED: "the facility has restricted this genre",
  CORRECTIONS_GENRE_NOT_ALLOWED: "the facility does not allow this genre",
  CORRECTIONS_FACILITY_OR_TERRITORY_REQUIRED: "the facility or its territory is not configured",
  ORGANISATION_OWNERSHIP_INVALID: "the recording is not available to this organisation"
});
export function correctionsMusicReason(reason) { return MUSIC_REASONS[reason] || "the recording does not meet the current rights and facility policy"; }

export function correctionsC5Features(entitlements = {}) {
  const tier = entitlements.correctionsRadioEnabled ? Number(entitlements.planTierNumber) || 0 : 0;
  return Object.freeze({
    tier,
    rehabilitation: tier >= 1,
    rehabilitationManagement: tier >= 2,
    internalRequests: tier >= 2,
    familyRequests: tier >= 2,
    development: tier >= 2,
    advanced: tier >= 3,
    network: tier >= 4,
    customTaxonomy: tier >= 5
  });
}

function shortText(value, max, label, { required = false } = {}) {
  if (value !== undefined && value !== null && typeof value !== "string") throw inputError(`${label} must be text.`);
  const text = String(value || "").trim();
  if (required && !text) throw inputError(`Enter ${label.toLowerCase()}.`);
  if (text.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw inputError(`${label} must be no more than ${max} plain-text characters.`);
  return text || null;
}

export function normalizeCorrectionsRequest(input = {}, source = "INTERNAL") {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw inputError("Enter a request.");
  if (!["INTERNAL", "FAMILY"].includes(source)) throw inputError("Choose a request source.");
  const forbidden = ["offence", "sentence", "medical", "diagnosis", "address", "dateOfBirth", "identityDocument", "prisonNumber"];
  if (forbidden.some((key) => Object.hasOwn(input, key))) throw inputError("This form does not accept sensitive personal records.");
  const type = String(input.type || "").toUpperCase();
  if (!["SONG", "PROGRAMME", "DEDICATION", "MESSAGE", "REHABILITATION_SUGGESTION"].includes(type)) throw inputError("Choose a request type.");
  if (source === "FAMILY" && !["SONG", "DEDICATION", "MESSAGE"].includes(type)) throw inputError("This public form accepts radio requests and moderated messages only.");
  const result = {
    source, type,
    senderDisplayName: shortText(input.senderDisplayName, 80, "Sender display name", { required: source === "FAMILY" }),
    relationship: shortText(input.relationship, 60, "Relationship"),
    recipientReference: shortText(input.recipientReference, 80, "Recipient reference", { required: source === "FAMILY" }),
    recipientDisplayName: shortText(input.recipientDisplayName, 80, "Recipient display name"),
    wingOrUnit: shortText(input.wingOrUnit, 80, "Wing or unit"),
    songTitle: shortText(input.songTitle, 160, "Song or programme title"),
    songArtist: shortText(input.songArtist, 160, "Artist"),
    originalMessage: shortText(input.message, 500, "Message")
  };
  if (type === "SONG" && !result.songTitle) throw inputError("Enter a song title.");
  if (["MESSAGE", "DEDICATION", "REHABILITATION_SUGGESTION"].includes(type) && !result.originalMessage) throw inputError("Enter a short message.");
  if (source === "FAMILY" && input.consent !== true) throw inputError("Confirm the privacy notice before sending.");
  return result;
}

export function correctionsRequestAllowed(facility, source, type) {
  if (!facility || facility.requestAvailability === "DISABLED") return false;
  if (source === "FAMILY" && facility.requestAvailability !== "FAMILY_AND_INTERNAL") return false;
  if (type === "SONG" && !facility.songRequestsEnabled) return false;
  if (type === "MESSAGE" && !facility.messageRequestsEnabled) return false;
  if (type === "DEDICATION" && !facility.dedicationsEnabled) return false;
  return true;
}

export function correctionsRequestTransition(request, action) {
  const allowed = {
    RECEIVED: { SCREEN: "SCREENING", REJECT: "REJECTED" },
    SCREENING: { APPROVE: "APPROVED", REJECT: "REJECTED" },
    APPROVED: { ARCHIVE: "ARCHIVED" },
    REJECTED: { ARCHIVE: "ARCHIVED" },
    PLAYED: { ARCHIVE: "ARCHIVED" }
  };
  // Scheduling and delivery remain controlled by the shared playout guard.
  return allowed[request?.status]?.[action] || null;
}

export function normalizeOnAirText(input = {}) {
  return {
    onAirRecipient: shortText(input.onAirRecipient, 80, "On-air recipient"),
    onAirMessage: shortText(input.onAirMessage, 500, "On-air message"),
    note: shortText(input.note, 500, "Review note")
  };
}

export function safeCorrectionsRequestSummary(request) {
  return { id: request.id, facilityId: request.facilityId, source: request.source, type: request.type,
    status: request.status, createdAt: request.createdAt, songTitle: request.songTitle, songArtist: request.songArtist };
}
