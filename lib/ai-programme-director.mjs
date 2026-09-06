import { isValidIanaTimezone } from "./opening-hours.mjs";

export const PROGRAMME_DIRECTOR_OBJECTIVES = Object.freeze([
  "CONTINUITY",
  "DAYPART_BALANCE",
  "ROTATION_VARIETY"
]);

export const PROGRAMME_DIRECTOR_DAILY_LIMIT = 20;
export const PROGRAMME_DIRECTOR_POLICY_VERSION = "programme-director-v1";

function cleanText(value, label, { min = 1, max = 2_000 } = {}) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < min) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

export function canRequestProgrammeDirector(role) {
  return ["OWNER", "MANAGER", "CONTENT_EDITOR"].includes(String(role || "").toUpperCase());
}

export function canReviewProgrammeDirector(role) {
  return ["OWNER", "MANAGER"].includes(String(role || "").toUpperCase());
}

export function normalizeProgrammeDirectorRequest(input = {}) {
  const objective = String(input.objective || "CONTINUITY").toUpperCase();
  if (!PROGRAMME_DIRECTOR_OBJECTIVES.includes(objective)) throw new Error("Select a supported programme objective.");
  const timezone = String(input.timezone || "Europe/Malta").trim();
  if (!isValidIanaTimezone(timezone)) throw new Error("Select a valid IANA timezone.");
  return {
    channelId: cleanText(input.channelId, "Channel", { max: 120 }),
    fallbackMusicModeId: cleanText(input.fallbackMusicModeId, "Continuity music mode", { max: 120 }),
    objective,
    title: cleanText(input.title, "Plan title", { min: 2, max: 160 }),
    brief: cleanText(input.brief, "Programming brief", { min: 10, max: 2_000 }),
    timezone
  };
}

function sourceId(item) {
  if (item.sourceId) return item.sourceId;
  if (item.sourceType === "MUSIC_MODE") return item.musicModeId;
  if (item.sourceType === "RADIO_CLOCK") return item.radioClockId;
  if (item.sourceType === "SHOW_RUNDOWN") return item.schoolRundownId;
  return null;
}

function storedItem(item) {
  return {
    label: String(item.label || "Programme item").slice(0, 160),
    recurrence: item.recurrence,
    sourceType: item.sourceType,
    weekday: item.weekday ?? null,
    startTime: item.startTime ?? (Number.isInteger(item.startMinute) ? `${String(Math.floor(item.startMinute / 60)).padStart(2, "0")}:${String(item.startMinute % 60).padStart(2, "0")}` : null),
    startsAt: item.startsAt || null,
    durationMinutes: item.durationMinutes,
    priority: Math.max(10, Number(item.priority) || 0),
    sourceId: sourceId(item)
  };
}

function hasFullDayCover(items, weekday) {
  return items.some((item) => item.recurrence === "WEEKLY" && item.weekday === weekday && Number(item.durationMinutes) === 1440 && (item.startTime === "00:00" || item.startMinute === 0));
}

export function buildProgrammeDirectorPlan({ request, channel, fallbackMusicMode, schedule = null }) {
  const normalized = normalizeProgrammeDirectorRequest(request);
  if (!channel || channel.id !== normalized.channelId) throw new Error("Choose an active channel owned by this organisation.");
  if (!fallbackMusicMode || fallbackMusicMode.id !== normalized.fallbackMusicModeId) throw new Error("Choose an active, playable continuity music mode.");

  const baselineVersion = schedule?.versions?.[0] || null;
  const baselineItems = (baselineVersion?.items || []).map(storedItem);
  const missingWeekdays = Array.from({ length: 7 }, (_, weekday) => weekday).filter((weekday) => !hasFullDayCover(baselineItems, weekday));
  const continuityItems = missingWeekdays.map((weekday) => ({
    label: `${fallbackMusicMode.name} · continuity bed`,
    recurrence: "WEEKLY",
    sourceType: "MUSIC_MODE",
    weekday,
    startTime: "00:00",
    startsAt: null,
    durationMinutes: 1440,
    priority: 0,
    sourceId: fallbackMusicMode.id
  }));
  const items = [...continuityItems, ...baselineItems].map((item, position) => ({ ...item, position }));
  if (!items.length) throw new Error("The Programme Director could not create a usable plan.");
  if (items.length > 200) throw new Error("This channel already has too many schedule items to add a safe continuity layer.");

  return {
    scheduleId: schedule?.id || null,
    baselineVersionId: baselineVersion?.id || null,
    baselineVersion: baselineVersion?.version || null,
    name: schedule?.name || `${channel.name} programme plan`,
    channelId: channel.id,
    channelName: channel.name,
    stationName: channel.station?.name || null,
    timezone: schedule?.timezone || normalized.timezone,
    objective: normalized.objective,
    title: normalized.title,
    brief: normalized.brief,
    fallbackMusicMode: { id: fallbackMusicMode.id, name: fallbackMusicMode.name },
    items,
    evidence: {
      baselineItemCount: baselineItems.length,
      continuityItemsAdded: continuityItems.length,
      coveredWeekdaysBefore: 7 - missingWeekdays.length,
      reviewedAt: new Date().toISOString()
    },
    controls: {
      humanReviewRequired: true,
      createsDraftOnly: true,
      autoPublishAllowed: false,
      externalProviderUsed: false,
      privateDataSent: false,
      policyVersion: PROGRAMME_DIRECTOR_POLICY_VERSION
    }
  };
}

export function programmeDirectorDraftText(plan) {
  const objective = String(plan.objective || "").toLowerCase().replaceAll("_", " ");
  return [
    `DRAFT PROGRAMME DIRECTOR RECOMMENDATION`,
    ``,
    `Plan: ${plan.title}`,
    `Station/channel: ${[plan.stationName, plan.channelName].filter(Boolean).join(" / ")}`,
    `Objective: ${objective}`,
    `Programming brief: ${plan.brief}`,
    ``,
    `Recommendation`,
    `Retain ${plan.evidence.baselineItemCount} existing programme item${plan.evidence.baselineItemCount === 1 ? "" : "s"} and add ${plan.evidence.continuityItemsAdded} governed continuity item${plan.evidence.continuityItemsAdded === 1 ? "" : "s"} using ${plan.fallbackMusicMode.name}. Existing programmes are raised above the continuity layer so they remain the preferred content in the draft.`,
    ``,
    `Evidence and limits`,
    `- ${plan.evidence.coveredWeekdaysBefore} of 7 weekdays already had full-day baseline cover.`,
    `- The recommendation uses organisation-owned scheduling metadata and an eligible Music Mode only.`,
    `- No listener identity, student data, raw audio or provider credential was shared.`,
    `- This local rules engine has no external AI cost.`,
    ``,
    `Human decision required`,
    `An owner or manager must review this recommendation. Approval does not change live radio. A second deliberate action creates a new schedule draft for preview; normal schedule publishing remains separate.`
  ].join("\n");
}

export function programmeDirectorProvenance(plan) {
  return {
    stage: "19.24",
    policyVersion: PROGRAMME_DIRECTOR_POLICY_VERSION,
    providerKey: "RUVANAS_PROGRAMME_RULES_V1",
    objective: plan.objective,
    channelId: plan.channelId,
    scheduleId: plan.scheduleId,
    baselineVersionId: plan.baselineVersionId,
    evidenceCapturedAt: plan.evidence.reviewedAt,
    humanReviewRequired: true,
    createsDraftOnly: true,
    autoPublishAllowed: false,
    privateDataSent: false,
    externalProviderUsed: false
  };
}

export function programmeDirectorPlanForSchedule(plan) {
  if (!plan?.controls?.humanReviewRequired || plan?.controls?.autoPublishAllowed !== false) throw new Error("The recommendation is missing its governed review controls.");
  return {
    channelId: plan.channelId,
    name: plan.name,
    timezone: plan.timezone,
    items: plan.items.map(({ position: _position, ...item }) => item)
  };
}
