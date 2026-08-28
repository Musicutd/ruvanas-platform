export const AI_ASSISTANT_TYPES = Object.freeze([
  "PROMO_SCRIPT",
  "SCHEDULE_RULES",
  "ANALYTICS_SUMMARY",
  "SCHOOL_SCRIPT",
  "SCHOOL_SHOW_PLAN",
  "SCHOOL_PRONUNCIATION"
]);

export const AI_DATA_CLASSIFICATIONS = Object.freeze([
  "INTERNAL",
  "CUSTOMER_CONTENT",
  "SCHOOL_CONTENT",
  "SCHOOL_STUDENT_DATA"
]);

const REVIEW_TRANSITIONS = Object.freeze({
  NEEDS_REVIEW: Object.freeze(["APPROVED", "REJECTED"]),
  APPROVED: Object.freeze([]),
  REJECTED: Object.freeze([]),
  FAILED: Object.freeze([])
});

function cleanText(value, label, { min = 1, max = 2_000 } = {}) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < min) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

export function normalizeAssistantRequest(input = {}) {
  const assistantType = String(input.assistantType || "").toUpperCase();
  if (!AI_ASSISTANT_TYPES.includes(assistantType)) throw new Error("Select a supported assistant type.");
  const dataClassification = String(input.dataClassification || "INTERNAL").toUpperCase();
  if (!AI_DATA_CLASSIFICATIONS.includes(dataClassification)) throw new Error("Select a supported data classification.");
  const durationSeconds = Number(input.durationSeconds || 30);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 3_600) {
    throw new Error("Duration must be between 10 and 3600 seconds.");
  }
  return {
    assistantType,
    dataClassification,
    title: cleanText(input.title, "Title", { max: 160 }),
    audience: cleanText(input.audience, "Audience", { max: 240 }),
    brief: cleanText(input.brief, "Brief", { min: 10, max: 4_000 }),
    callToAction: String(input.callToAction || "").replace(/\s+/g, " ").trim().slice(0, 500),
    tone: String(input.tone || "clear and professional").replace(/\s+/g, " ").trim().slice(0, 120) || "clear and professional",
    durationSeconds
  };
}

export function assertProviderDataPolicy({ providerKey, dataClassification, providerDataUseApproved = false }) {
  const isLocal = providerKey === "RUVANAS_TEMPLATE_V1";
  if (!isLocal && !providerDataUseApproved) {
    throw new Error("Third-party provider data-use terms must be approved before content is shared.");
  }
  if (!isLocal && dataClassification === "SCHOOL_STUDENT_DATA") {
    throw new Error("Private student data cannot be sent to a third-party assistant in this stage.");
  }
  return { privateDataSent: !isLocal, providerDataUseApproved: isLocal ? false : true };
}

function estimatedWords(durationSeconds) {
  return Math.max(20, Math.round(durationSeconds * 2.35));
}

export function generateGovernedDraft(request) {
  const input = normalizeAssistantRequest(request);
  const wordTarget = estimatedWords(input.durationSeconds);
  const cta = input.callToAction ? `\n\nCall to action: ${input.callToAction}` : "";
  const common = `Working title: ${input.title}\nAudience: ${input.audience}\nTone: ${input.tone}\nTarget length: about ${wordTarget} words`;
  const drafts = {
    PROMO_SCRIPT: `${common}\n\nDRAFT PROMO SCRIPT\n\n${input.brief}${cta}\n\nProduction note: verify every offer, date, price and legal condition before recording or campaign use.`,
    SCHEDULE_RULES: `${common}\n\nDRAFT SCHEDULING PROPOSAL\n\nObjective: ${input.brief}\n\nSuggested review points:\n1. Confirm the target locations, zones and opening hours.\n2. Confirm repetition limits and separation rules.\n3. Preview conflicts before publishing.\n4. Approve the final schedule through the normal publishing workflow.${cta}`,
    ANALYTICS_SUMMARY: `${common}\n\nDRAFT ANALYTICS NARRATIVE\n\n${input.brief}\n\nInterpretation boundary: this draft summarizes supplied, authorized metrics only. It does not infer audience, sales impact or causality without supporting evidence.${cta}`,
    SCHOOL_SCRIPT: `${common}\n\nDRAFT SCHOOL RADIO SCRIPT\n\nOpening: Welcome listeners and introduce ${input.title}.\n\nMain segment: ${input.brief}\n\nClosing: Recap the key learning point and thank contributors.${cta}\n\nStaff review note: check names, safeguarding, consent, accuracy and age-appropriateness before any recording or publication.`,
    SCHOOL_SHOW_PLAN: `${common}\n\nDRAFT SHOW PLAN\n\n1. Welcome and context\n2. Main discussion: ${input.brief}\n3. Student reflection or interview\n4. Key learning recap\n5. Closing${cta}\n\nStaff review note: confirm supervision, consent, music rights and publication readiness.`,
    SCHOOL_PRONUNCIATION: `${common}\n\nDRAFT PRONUNCIATION PREPARATION\n\nText or terms to practise: ${input.brief}\n\nSuggested workflow: mark syllables, confirm names with the speaker or an authoritative source, rehearse slowly, then record a staff-reviewed take.${cta}`
  };
  return drafts[input.assistantType];
}

export function assertAIReviewTransition(fromStatus, toStatus) {
  const from = String(fromStatus || "").toUpperCase();
  const to = String(toStatus || "").toUpperCase();
  if (!(REVIEW_TRANSITIONS[from] || []).includes(to)) {
    throw new Error(`AI draft cannot move from ${from || "UNKNOWN"} to ${to || "UNKNOWN"}.`);
  }
  return to;
}

export function normalizeHumanReview({ decision, editedText, reviewNote }) {
  const status = String(decision || "").toUpperCase();
  if (!["APPROVED", "REJECTED"].includes(status)) throw new Error("Choose APPROVED or REJECTED.");
  const approvedText = status === "APPROVED"
    ? cleanText(editedText, "Approved draft", { min: 10, max: 20_000 })
    : null;
  const note = String(reviewNote || "").trim().slice(0, 2_000) || null;
  return { status, approvedText, reviewNote: note };
}

export function aiArtifactProvenance({ assistantType, dataClassification, providerKey = "RUVANAS_TEMPLATE_V1" }) {
  return {
    assistantType,
    dataClassification,
    providerKey,
    humanReviewRequired: true,
    autoPublishAllowed: false,
    privateDataSent: providerKey !== "RUVANAS_TEMPLATE_V1"
  };
}

