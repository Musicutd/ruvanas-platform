import { hasSubscriberProduct } from "./product-access.mjs";

export const BETA_PRODUCTS = Object.freeze([
  Object.freeze({ value: "RETAIL", label: "Retail / In-house Radio" }),
  Object.freeze({ value: "SCHOOL", label: "School Radio" }),
  Object.freeze({ value: "ONLINE", label: "Online Radio" }),
  Object.freeze({ value: "HEALTH", label: "Health Radio" }),
  Object.freeze({ value: "FAITH", label: "Faith Radio" }),
  Object.freeze({ value: "ORGANISATIONS", label: "Ruvanas Organisations" })
]);

export const BETA_FEEDBACK_CATEGORIES = Object.freeze([
  Object.freeze({ value: "USABILITY", label: "Ease of use" }),
  Object.freeze({ value: "RELIABILITY", label: "Reliability or playback" }),
  Object.freeze({ value: "CONTENT", label: "Music or content" }),
  Object.freeze({ value: "ACCESS", label: "Account or product access" }),
  Object.freeze({ value: "FEATURE_REQUEST", label: "Feature suggestion" }),
  Object.freeze({ value: "OTHER", label: "Something else" })
]);

export const BETA_FEEDBACK_SEVERITIES = Object.freeze([
  Object.freeze({ value: "LOW", label: "Minor" }),
  Object.freeze({ value: "NORMAL", label: "Normal" }),
  Object.freeze({ value: "HIGH", label: "Important" }),
  Object.freeze({ value: "BLOCKER", label: "Stops our testing" })
]);

const PRODUCT_VALUES = new Set(BETA_PRODUCTS.map((item) => item.value));
const CATEGORY_VALUES = new Set(BETA_FEEDBACK_CATEGORIES.map((item) => item.value));
const SEVERITY_VALUES = new Set(BETA_FEEDBACK_SEVERITIES.map((item) => item.value));
const PARTICIPANT_TRANSITIONS = Object.freeze({
  ACTIVE: new Set(["PAUSED", "COMPLETED", "REMOVED"]),
  PAUSED: new Set(["ACTIVE", "COMPLETED", "REMOVED"]),
  COMPLETED: new Set(["ACTIVE"]),
  REMOVED: new Set([])
});
const PROGRAMME_TRANSITIONS = Object.freeze({
  DRAFT: new Set(["ACTIVE", "CLOSED"]),
  ACTIVE: new Set(["PAUSED", "CLOSED"]),
  PAUSED: new Set(["ACTIVE", "CLOSED"]),
  CLOSED: new Set([])
});
const FEEDBACK_TRANSITIONS = Object.freeze({
  NEW: new Set(["TRIAGED", "PLANNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
  TRIAGED: new Set(["PLANNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
  PLANNED: new Set(["IN_PROGRESS", "RESOLVED", "CLOSED"]),
  IN_PROGRESS: new Set(["PLANNED", "RESOLVED", "CLOSED"]),
  RESOLVED: new Set(["IN_PROGRESS", "CLOSED"]),
  CLOSED: new Set([])
});

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function betaProductLabel(value) {
  return BETA_PRODUCTS.find((item) => item.value === value)?.label || "Ruvanas product";
}

export function betaFeedbackCategoryLabel(value) {
  return BETA_FEEDBACK_CATEGORIES.find((item) => item.value === value)?.label || "General feedback";
}

export function normalizeBetaProgramme(input = {}) {
  const name = cleanText(input.name, 120);
  const description = String(input.description || "").trim().slice(0, 4_000) || null;
  const maxOrganisations = Number(input.maxOrganisations);
  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (name.length < 3) throw new Error("Use a beta programme name of at least three characters.");
  if (!Number.isInteger(maxOrganisations) || maxOrganisations < 1 || maxOrganisations > 500) {
    throw new Error("Set a beta capacity between 1 and 500 organisations.");
  }
  if (startsAt && Number.isNaN(startsAt.getTime())) throw new Error("Choose a valid beta start date.");
  if (endsAt && Number.isNaN(endsAt.getTime())) throw new Error("Choose a valid beta end date.");
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error("The beta end date must be after its start date.");
  return { name, description, maxOrganisations, startsAt, endsAt };
}

export function normalizeBetaParticipant(input = {}) {
  const programmeId = cleanText(input.programmeId, 191);
  const organisationId = cleanText(input.organisationId, 191);
  const product = cleanText(input.product, 20).toUpperCase();
  const internalNote = String(input.internalNote || "").trim().slice(0, 1_000) || null;
  if (!programmeId || !organisationId) throw new Error("Choose a beta programme and organisation.");
  if (!PRODUCT_VALUES.has(product)) throw new Error("Choose a Ruvanas radio product.");
  return { programmeId, organisationId, product, internalNote };
}

export function betaParticipantDecision({ programme, organisation, product, activeCount = 0 } = {}) {
  if (!programme || !["DRAFT", "ACTIVE"].includes(programme.status)) {
    return { ok: false, status: 409, error: "Participants can only be added to a draft or active beta programme." };
  }
  if (activeCount >= programme.maxOrganisations) {
    return { ok: false, status: 409, error: "This beta programme has reached its organisation capacity." };
  }
  if (!organisation?.subscription) {
    return { ok: false, status: 409, error: "The organisation needs an active Ruvanas service before joining the beta." };
  }
  if (!hasSubscriberProduct(organisation.entitlements, product)) {
    return { ok: false, status: 409, error: `The organisation is not entitled to ${betaProductLabel(product)}.` };
  }
  return { ok: true };
}

export function normalizeBetaFeedback(input = {}) {
  const participantId = cleanText(input.participantId, 191);
  const category = cleanText(input.category, 30).toUpperCase();
  const severity = cleanText(input.severity, 20).toUpperCase();
  const subject = cleanText(input.subject, 160);
  const description = String(input.description || "").trim().slice(0, 6_000);
  const rating = input.rating === null || input.rating === undefined || input.rating === "" ? null : Number(input.rating);
  if (!participantId) throw new Error("Choose the beta product you are testing.");
  if (!CATEGORY_VALUES.has(category)) throw new Error("Choose a feedback category.");
  if (!SEVERITY_VALUES.has(severity)) throw new Error("Choose how strongly this affects testing.");
  if (subject.length < 3 || subject.length > 160) throw new Error("Use a subject between 3 and 160 characters.");
  if (description.length < 20 || description.length > 6_000) throw new Error("Describe the feedback using between 20 and 6,000 characters.");
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error("Rate the experience from 1 to 5.");
  return { participantId, category, severity, subject, description, rating };
}

export function assertBetaTransition(kind, current, next) {
  const transitions = kind === "programme" ? PROGRAMME_TRANSITIONS : kind === "participant" ? PARTICIPANT_TRANSITIONS : FEEDBACK_TRANSITIONS;
  if (current === next) return true;
  if (!transitions[current]?.has(next)) throw new Error(`${kind} status cannot move from ${current} to ${next}.`);
  return true;
}

export function betaFeedbackVisibility({ membershipRole = "VIEWER", userId } = {}) {
  if (!userId) throw new Error("A signed-in user is required.");
  return ["OWNER", "MANAGER"].includes(membershipRole) ? {} : { createdByUserId: userId };
}

export function betaOperationsSummary(programmes = []) {
  const participants = programmes.flatMap((programme) => programme.participants || []);
  const feedback = programmes.flatMap((programme) => programme.feedback || []);
  return Object.freeze({
    activeProgrammes: programmes.filter((programme) => programme.status === "ACTIVE").length,
    activeParticipants: participants.filter((participant) => participant.status === "ACTIVE").length,
    openFeedback: feedback.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status)).length,
    blockers: feedback.filter((item) => item.severity === "BLOCKER" && !["RESOLVED", "CLOSED"].includes(item.status)).length
  });
}
