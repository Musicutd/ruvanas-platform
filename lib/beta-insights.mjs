import { BETA_PRODUCTS } from "./beta-operations.mjs";

export const BETA_REVIEW_DECISIONS = Object.freeze([
  Object.freeze({ value: "CONTINUE_BETA", label: "Continue beta", description: "Keep or return the programme to active testing." }),
  Object.freeze({ value: "PAUSE_AND_FIX", label: "Pause and fix", description: "Pause new testing while the team resolves important findings." }),
  Object.freeze({ value: "EXPAND_COHORT", label: "Expand cohort", description: "Increase the controlled capacity after the evidence gate is clear." }),
  Object.freeze({ value: "END_BETA", label: "End beta", description: "Close the programme and preserve its evidence history." })
]);

const DECISION_VALUES = new Set(BETA_REVIEW_DECISIONS.map((item) => item.value));
const OPEN_FEEDBACK_STATUSES = new Set(["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS"]);

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function countBy(items, values, key) {
  return values.map((value) => Object.freeze({
    value,
    count: items.filter((item) => item?.[key] === value).length
  }));
}

function percent(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

export function betaReviewDecisionLabel(value) {
  return BETA_REVIEW_DECISIONS.find((item) => item.value === value)?.label || "Recorded decision";
}

export function buildBetaProgrammeInsights(programme = {}) {
  const participants = Array.isArray(programme.participants) ? programme.participants : [];
  const feedback = Array.isArray(programme.feedback) ? programme.feedback : [];
  const includedParticipants = participants.filter((item) => item.status !== "REMOVED");
  const activeParticipants = includedParticipants.filter((item) => item.status === "ACTIVE");
  const organisationIds = new Set(includedParticipants.map((item) => item.organisationId).filter(Boolean));
  const activeOrganisationIds = new Set(activeParticipants.map((item) => item.organisationId).filter(Boolean));
  const participantIdsWithFeedback = new Set(feedback.map((item) => item.participantId).filter(Boolean));
  const openFeedback = feedback.filter((item) => OPEN_FEEDBACK_STATUSES.has(item.status));
  const resolvedFeedback = feedback.filter((item) => ["RESOLVED", "CLOSED"].includes(item.status));
  const respondedFeedback = feedback.filter((item) => Boolean(String(item.adminResponse || "").trim()));
  const ratedFeedback = feedback.filter((item) => Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5);
  const ratingTotal = ratedFeedback.reduce((total, item) => total + item.rating, 0);
  const averageRating = ratedFeedback.length ? Number((ratingTotal / ratedFeedback.length).toFixed(1)) : null;
  const openBlockers = openFeedback.filter((item) => item.severity === "BLOCKER").length;
  const untriagedFeedback = feedback.filter((item) => item.status === "NEW").length;
  const findings = [];

  if (!activeOrganisationIds.size) findings.push({ level: "BLOCKER", code: "NO_ACTIVE_ORGANISATIONS", message: "At least one organisation must remain active before a beta can expand." });
  if (openBlockers) findings.push({ level: "BLOCKER", code: "OPEN_TESTING_BLOCKERS", message: `${openBlockers} testing blocker${openBlockers === 1 ? " remains" : "s remain"} open.` });
  if (untriagedFeedback) findings.push({ level: "ATTENTION", code: "UNTRIAGED_FEEDBACK", message: `${untriagedFeedback} feedback item${untriagedFeedback === 1 ? " still needs" : "s still need"} triage.` });
  if (feedback.length < 3) findings.push({ level: "ATTENTION", code: "LIMITED_FEEDBACK", message: "Collect at least three feedback items before expanding the cohort." });
  if (activeOrganisationIds.size < 2) findings.push({ level: "ATTENTION", code: "LIMITED_COHORT", message: "Use evidence from at least two active organisations before expanding the cohort." });

  const readiness = findings.some((item) => item.level === "BLOCKER")
    ? "BLOCKED"
    : findings.length
      ? "ATTENTION"
      : "READY_FOR_DECISION";

  const products = BETA_PRODUCTS.map((product) => {
    const productParticipants = includedParticipants.filter((item) => item.product === product.value);
    const productFeedback = feedback.filter((item) => item.product === product.value);
    const productRatings = productFeedback.filter((item) => Number.isInteger(item.rating));
    return Object.freeze({
      product: product.value,
      label: product.label,
      participants: productParticipants.length,
      activeParticipants: productParticipants.filter((item) => item.status === "ACTIVE").length,
      feedback: productFeedback.length,
      openFeedback: productFeedback.filter((item) => OPEN_FEEDBACK_STATUSES.has(item.status)).length,
      averageRating: productRatings.length
        ? Number((productRatings.reduce((total, item) => total + item.rating, 0) / productRatings.length).toFixed(1))
        : null
    });
  });

  return Object.freeze({
    readiness,
    findings: Object.freeze(findings.map((item) => Object.freeze(item))),
    organisations: organisationIds.size,
    activeOrganisations: activeOrganisationIds.size,
    participants: includedParticipants.length,
    activeParticipants: activeParticipants.length,
    feedback: feedback.length,
    openFeedback: openFeedback.length,
    resolvedFeedback: resolvedFeedback.length,
    openBlockers,
    untriagedFeedback,
    averageRating,
    ratedFeedback: ratedFeedback.length,
    responseRate: percent(respondedFeedback.length, feedback.length),
    resolutionRate: percent(resolvedFeedback.length, feedback.length),
    participationCoverage: percent(participantIdsWithFeedback.size, includedParticipants.length),
    products: Object.freeze(products),
    categories: Object.freeze(countBy(feedback, ["USABILITY", "RELIABILITY", "CONTENT", "ACCESS", "FEATURE_REQUEST", "OTHER"], "category")),
    severities: Object.freeze(countBy(feedback, ["LOW", "NORMAL", "HIGH", "BLOCKER"], "severity")),
    statuses: Object.freeze(countBy(feedback, ["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS", "RESOLVED", "CLOSED"], "status"))
  });
}

export function buildBetaPortfolioInsights(programmes = []) {
  const insights = programmes.map((programme) => buildBetaProgrammeInsights(programme));
  return Object.freeze({
    programmes: programmes.length,
    activeProgrammes: programmes.filter((item) => item.status === "ACTIVE").length,
    organisations: new Set(programmes.flatMap((item) => (item.participants || []).filter((participant) => participant.status !== "REMOVED").map((participant) => participant.organisationId))).size,
    feedback: insights.reduce((total, item) => total + item.feedback, 0),
    openBlockers: insights.reduce((total, item) => total + item.openBlockers, 0),
    readyProgrammes: insights.filter((item) => item.readiness === "READY_FOR_DECISION").length
  });
}

export function normalizeBetaReview(input = {}) {
  const programmeId = cleanText(input.programmeId, 191);
  const decision = cleanText(input.decision, 40).toUpperCase();
  const reviewNote = String(input.reviewNote || "").trim().slice(0, 4_000);
  const evidenceReference = cleanText(input.evidenceReference, 300) || null;
  const nextCapacity = input.nextCapacity === null || input.nextCapacity === undefined || input.nextCapacity === ""
    ? null
    : Number(input.nextCapacity);
  if (!programmeId) throw new Error("Choose a beta programme.");
  if (!DECISION_VALUES.has(decision)) throw new Error("Choose a valid beta review decision.");
  if (reviewNote.length < 20) throw new Error("Add a review note of at least 20 characters.");
  if (["EXPAND_COHORT", "END_BETA"].includes(decision) && !evidenceReference) {
    throw new Error("Add an evidence reference before expanding or ending the beta.");
  }
  if (nextCapacity !== null && (!Number.isInteger(nextCapacity) || nextCapacity < 1 || nextCapacity > 500)) {
    throw new Error("Set the next cohort capacity between 1 and 500 organisations.");
  }
  return { programmeId, decision, reviewNote, evidenceReference, nextCapacity };
}

export function betaReviewDecision({ programme, insights, review }) {
  if (!programme || !["ACTIVE", "PAUSED"].includes(programme.status)) {
    throw new Error("Only an active or paused beta programme can be reviewed.");
  }
  if (!insights || !review) throw new Error("Beta review evidence is required.");
  if (review.decision === "EXPAND_COHORT") {
    if (insights.readiness !== "READY_FOR_DECISION") throw new Error("Resolve the beta readiness findings before expanding the cohort.");
    if (!Number.isInteger(review.nextCapacity) || review.nextCapacity <= programme.maxOrganisations) {
      throw new Error("The expanded cohort capacity must be higher than the current capacity.");
    }
  } else if (review.nextCapacity !== null) {
    throw new Error("A new capacity can only be set when expanding the cohort.");
  }

  const nextStatus = review.decision === "PAUSE_AND_FIX"
    ? "PAUSED"
    : review.decision === "END_BETA"
      ? "CLOSED"
      : "ACTIVE";
  return Object.freeze({
    nextStatus,
    nextCapacity: review.decision === "EXPAND_COHORT" ? review.nextCapacity : programme.maxOrganisations
  });
}

export function betaReviewSnapshot(insights, programme) {
  return Object.freeze({
    schemaVersion: "stage-30b-v1",
    programmeStatus: programme.status,
    maxOrganisations: programme.maxOrganisations,
    readiness: insights.readiness,
    organisations: insights.organisations,
    activeOrganisations: insights.activeOrganisations,
    participants: insights.participants,
    feedback: insights.feedback,
    openFeedback: insights.openFeedback,
    openBlockers: insights.openBlockers,
    untriagedFeedback: insights.untriagedFeedback,
    averageRating: insights.averageRating,
    responseRate: insights.responseRate,
    resolutionRate: insights.resolutionRate,
    participationCoverage: insights.participationCoverage,
    products: insights.products.map((item) => ({
      product: item.product,
      participants: item.participants,
      feedback: item.feedback,
      openFeedback: item.openFeedback,
      averageRating: item.averageRating
    }))
  });
}
