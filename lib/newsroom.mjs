import { createHash } from "node:crypto";

export const NEWSROOM_PRODUCTS = Object.freeze({
  ONLINE_RADIO: "ONLINE_RADIO",
  SCHOOL_RADIO: "SCHOOL_RADIO"
});

export const NEWS_SOURCE_LIMIT = 50;
export const NEWSROOM_POLICY_VERSION = "newsroom-v1";

export const ONLINE_NEWS_TYPES = Object.freeze([
  "NEWS_BULLETIN",
  "INTERVIEW",
  "SPORTS_RESULT",
  "FEATURE_STORY",
  "WEATHER",
  "TRAFFIC",
  "COMMUNITY",
  "BUSINESS",
  "PUBLIC_SERVICE"
]);

const NEWS_TRANSITIONS = Object.freeze({
  ASSIGN: new Set(["PITCH"]),
  START_SCRIPT: new Set(["ASSIGNED", "PITCH"]),
  FACT_CHECK: new Set(["SCRIPTING"]),
  START_AUDIO: new Set(["FACT_CHECK"]),
  SUBMIT: new Set(["AUDIO_PRODUCTION"]),
  APPROVE: new Set(["IN_REVIEW"]),
  REQUEST_CHANGES: new Set(["IN_REVIEW"]),
  PUBLISH: new Set(["APPROVED"]),
  ARCHIVE: new Set(["PITCH", "ASSIGNED", "SCRIPTING", "FACT_CHECK", "AUDIO_PRODUCTION", "IN_REVIEW", "APPROVED", "PUBLISHED"])
});

const NEWS_TARGETS = Object.freeze({
  ASSIGN: "ASSIGNED",
  START_SCRIPT: "SCRIPTING",
  FACT_CHECK: "FACT_CHECK",
  START_AUDIO: "AUDIO_PRODUCTION",
  SUBMIT: "IN_REVIEW",
  APPROVE: "APPROVED",
  REQUEST_CHANGES: "SCRIPTING",
  PUBLISH: "PUBLISHED",
  ARCHIVE: "ARCHIVED"
});

function cleanText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

export function normalizeNewsSources(sources = []) {
  if (!Array.isArray(sources)) throw new Error("News sources must be supplied as a list.");
  if (sources.length > NEWS_SOURCE_LIMIT) throw new Error(`A story can contain no more than ${NEWS_SOURCE_LIMIT} sources.`);
  const seen = new Set();
  return sources.flatMap((source) => {
    const label = cleanText(source?.label, 200);
    const url = cleanText(source?.url, 1000) || null;
    const notes = cleanText(source?.notes, 500) || null;
    if (!label) throw new Error("Every newsroom source needs a label.");
    if (url) {
      let parsed;
      try { parsed = new URL(url); } catch { throw new Error("Newsroom source links must be valid web addresses."); }
      if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("Newsroom source links must use HTTP or HTTPS.");
    }
    const key = `${label.toLowerCase()}|${url || ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ label, url, notes }];
  });
}

export function newsroomSourceFingerprint(sources = []) {
  return createHash("sha256").update(JSON.stringify(normalizeNewsSources(sources))).digest("hex");
}

export function canEditNewsStory({ role, userId, assignedToUserId }) {
  if (new Set(["OWNER", "MANAGER"]).has(role)) return true;
  return role === "CONTENT_EDITOR" && (!assignedToUserId || assignedToUserId === userId);
}

export function transitionNewsStory({
  currentStatus,
  action,
  product = NEWSROOM_PRODUCTS.SCHOOL_RADIO,
  notes = null,
  interviewConsentConfirmed = false,
  hasInterviewAsset = false,
  hasScript = false,
  hasFactCheck = false,
  hasSources = false,
  hasProductionAsset = false
}) {
  if (!NEWS_TRANSITIONS[action]?.has(currentStatus)) throw new Error(`A ${currentStatus.toLowerCase().replaceAll("_", " ")} story cannot use ${action.toLowerCase().replaceAll("_", " ")}.`);
  const cleanNotes = cleanText(notes, 4000) || null;
  if (action === "REQUEST_CHANGES" && !cleanNotes) throw new Error("Editorial feedback is required when requesting changes.");
  if (action === "APPROVE" && hasInterviewAsset && !interviewConsentConfirmed) throw new Error("Confirm interview consent before approving this story.");
  if (product === NEWSROOM_PRODUCTS.ONLINE_RADIO) {
    if (action === "FACT_CHECK" && (!hasScript || !hasSources)) throw new Error("Add a script and at least one recorded source before fact-checking.");
    if (action === "START_AUDIO" && !hasFactCheck) throw new Error("Record fact-check notes before starting audio production.");
    if (action === "SUBMIT" && !hasProductionAsset) throw new Error("Attach a ready Studio project or interview recording before review.");
    if (action === "APPROVE" && (!hasScript || !hasFactCheck || !hasSources || !hasProductionAsset)) throw new Error("The script, sources, fact-check and production evidence must be complete before approval.");
  }
  return { status: NEWS_TARGETS[action], notes: cleanNotes };
}
