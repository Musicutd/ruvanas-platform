import crypto from "node:crypto";

export const RADIO_ADVERTISING_POLICY_VERSION = "radio-advertising-v1";
export const RADIO_ADVERTISING_MANAGER_ROLES = Object.freeze(["OWNER", "MANAGER"]);
export const RADIO_ADVERTISING_CONTENT_ROLES = Object.freeze(["OWNER", "MANAGER", "CONTENT_EDITOR"]);

const POLICY_ACTIONS = Object.freeze({
  ACTIVATE: new Set(["DRAFT", "PAUSED"]),
  PAUSE: new Set(["ACTIVE"]),
  RETURN_TO_DRAFT: new Set(["PAUSED"])
});

function integer(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function canManageRadioAdvertising(role) {
  return RADIO_ADVERTISING_MANAGER_ROLES.includes(String(role || "").toUpperCase());
}

export function canPrepareRadioAdvertising(role) {
  return RADIO_ADVERTISING_CONTENT_ROLES.includes(String(role || "").toUpperCase());
}

export function normalizeRadioAdvertisingPolicy(input = {}) {
  const pacingMode = String(input.pacingMode || "EVEN").trim().toUpperCase();
  if (!new Set(["EVEN", "PRIORITY"]).has(pacingMode)) throw new Error("Choose even or priority advertising pacing.");
  return {
    stationId: String(input.stationId || "").trim(),
    channelId: String(input.channelId || "").trim(),
    pacingMode,
    maxSpotsPerBreak: integer(input.maxSpotsPerBreak ?? 4, "Maximum spots per break", 1, 12),
    maxBreakSeconds: integer(input.maxBreakSeconds ?? 180, "Maximum break length", 15, 600),
    minBreakGapMinutes: integer(input.minBreakGapMinutes ?? 10, "Minimum break gap", 1, 180),
    maxAdvertisingSecondsPerHour: integer(input.maxAdvertisingSecondsPerHour ?? 720, "Maximum advertising time per hour", 30, 1800)
  };
}

export function radioAdvertisingConfigurationHash(policy) {
  return crypto.createHash("sha256").update(JSON.stringify(stable({
    policyVersion: RADIO_ADVERTISING_POLICY_VERSION,
    stationId: policy.stationId,
    channelId: policy.channelId,
    pacingMode: policy.pacingMode,
    maxSpotsPerBreak: policy.maxSpotsPerBreak,
    maxBreakSeconds: policy.maxBreakSeconds,
    minBreakGapMinutes: policy.minBreakGapMinutes,
    maxAdvertisingSecondsPerHour: policy.maxAdvertisingSecondsPerHour
  }))).digest("hex");
}

export function transitionRadioAdvertisingPolicy(currentStatus, action) {
  const normalized = String(action || "").trim().toUpperCase();
  if (!POLICY_ACTIONS[normalized]?.has(currentStatus)) throw new Error("That advertising policy action is not available in its current state.");
  if (normalized === "ACTIVATE") return "ACTIVE";
  if (normalized === "PAUSE") return "PAUSED";
  return "DRAFT";
}

export function campaignHasRadioTargets(campaign) {
  return (campaign?.targets || []).some((target) => target.targetType === "STATION" || target.targetType === "CHANNEL");
}

export function radioTargetMatches(target, { stationId, channelId } = {}) {
  if (target?.targetType === "STATION") return Boolean(stationId && target.stationId === stationId);
  if (target?.targetType === "CHANNEL") return Boolean(channelId && target.channelId === channelId);
  return false;
}

function rank(insertion) {
  const priority = { LOW: 1, NORMAL: 2, HIGH: 3, VERY_HIGH: 4 }[insertion.priority] || 0;
  return (insertion.mandatory ? 100 : 0) + priority;
}

function breakId(policy, plannedStart) {
  const interval = policy.minBreakGapMinutes * 60_000;
  const start = Math.floor(new Date(plannedStart).getTime() / interval) * interval;
  return crypto.createHash("sha256").update(`${policy.id}:${policy.revision}:${new Date(start).toISOString()}`).digest("hex");
}

export function applyRadioAdvertisingPolicy({ insertions = [], discarded = [], policy }) {
  const ordinary = insertions.filter((item) => !item.radioAdvertising);
  const advertising = insertions.filter((item) => item.radioAdvertising).sort((left, right) =>
    new Date(left.plannedStart) - new Date(right.plannedStart) || rank(right) - rank(left) || left.campaignId.localeCompare(right.campaignId)
  );
  if (!advertising.length) return { insertions, discarded, breaks: [] };
  if (!policy || policy.status !== "ACTIVE" || policy.revision < 1 || !policy.configurationHash) {
    return {
      insertions: ordinary,
      discarded: [...discarded, ...advertising.map((item) => ({ ...item, advertisingDecision: "NO_ACTIVE_RADIO_ADVERTISING_POLICY" }))],
      breaks: []
    };
  }

  const accepted = [];
  const rejected = [];
  const breaks = new Map();
  const hourSeconds = new Map();
  for (const item of advertising) {
    const id = breakId(policy, item.plannedStart);
    const hour = new Date(item.plannedStart).toISOString().slice(0, 13);
    const duration = Math.max(1, Number(item.durationSeconds) || 1);
    const currentBreak = breaks.get(id) || { id, plannedStart: new Date(item.plannedStart), spots: 0, seconds: 0 };
    const usedHour = hourSeconds.get(hour) || 0;
    let reason = null;
    if (currentBreak.spots >= policy.maxSpotsPerBreak) reason = "BREAK_SPOT_LIMIT";
    else if (currentBreak.seconds + duration > policy.maxBreakSeconds) reason = "BREAK_DURATION_LIMIT";
    else if (usedHour + duration > policy.maxAdvertisingSecondsPerHour) reason = "HOURLY_ADVERTISING_LIMIT";
    if (reason) {
      rejected.push({ ...item, advertisingDecision: reason });
      continue;
    }
    const position = currentBreak.spots + 1;
    const plannedStart = new Date(currentBreak.plannedStart.getTime() + currentBreak.seconds * 1000);
    currentBreak.spots = position;
    currentBreak.seconds += duration;
    breaks.set(id, currentBreak);
    hourSeconds.set(hour, usedHour + duration);
    accepted.push({
      ...item,
      plannedStart,
      advertising: { breakId: id, position, pacingMode: policy.pacingMode, policyId: policy.id, policyRevision: policy.revision }
    });
  }
  return {
    insertions: [...ordinary, ...accepted].sort((left, right) => new Date(left.plannedStart) - new Date(right.plannedStart) || left.scheduleItemId.localeCompare(right.scheduleItemId)),
    discarded: [...discarded, ...rejected],
    breaks: [...breaks.values()].map((item) => ({ ...item, plannedStart: item.plannedStart.toISOString() }))
  };
}

export function radioAdvertisingBookingReadiness({ order, stationId, channelId, endpoints = [], policy = null, policies = [], committedPlays = 0, estimatedPlays = 0 } = {}) {
  const blockers = [];
  const inventory = order?.inventoryPackage;
  const campaign = order?.campaign;
  const requiredEndpoints = endpoints.length ? endpoints : [{ stationId, channelId }];
  const activePolicies = policies.length ? policies : policy ? [policy] : [];
  if (!new Set(["APPROVED", "FULFILLED"]).has(order?.status)) blockers.push("The Retail Media order must be approved.");
  if (inventory?.status !== "ACTIVE") blockers.push("The selected Retail Media inventory must be active.");
  if (!campaign || campaign.status !== "PUBLISHED") blockers.push("The linked audio campaign must be published.");
  if (!(order?.creatives || []).some((creative) => creative.status === "APPROVED" && creative.promoVersionId === campaign?.promoVersionId)) blockers.push("The campaign creative must be approved on the order.");
  if (!requiredEndpoints.every((endpoint) => (inventory?.targets || []).some((target) => radioTargetMatches(target, endpoint)))) blockers.push("The inventory does not include every targeted station channel.");
  if (!requiredEndpoints.every((endpoint) => (campaign?.targets || []).some((target) => radioTargetMatches(target, endpoint)))) blockers.push("The campaign does not include every targeted station channel.");
  if (!requiredEndpoints.every((endpoint) => activePolicies.some((item) => item.channelId === endpoint.channelId && item.status === "ACTIVE" && item.revision >= 1 && item.configurationHash))) blockers.push("Every targeted channel needs an active approved advertising policy.");
  if (campaign && inventory) {
    const from = new Date(campaign.effectiveFrom).toISOString().slice(0, 10);
    const to = new Date(campaign.effectiveTo).toISOString().slice(0, 10);
    const inventoryFrom = new Date(inventory.effectiveFrom).toISOString().slice(0, 10);
    const inventoryTo = new Date(inventory.effectiveTo).toISOString().slice(0, 10);
    if (from < inventoryFrom || to > inventoryTo) blockers.push("Campaign dates must stay inside the booked inventory window.");
  }
  const availablePlays = Math.max(0, Number(inventory?.maxPlays || 0) - Number(committedPlays || 0));
  if (estimatedPlays > availablePlays) blockers.push("The requested placement volume exceeds the remaining inventory.");
  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    estimatedPlays,
    committedPlays,
    availablePlays,
    evidenceNotice: "A confirmed placement is scheduled delivery, not proof of listening, reach, response or commercial outcome."
  };
}

export function estimateRadioAdvertisingPlays(campaign) {
  if (!campaign?.effectiveFrom || !campaign?.effectiveTo) return 0;
  const start = new Date(campaign.effectiveFrom);
  const end = new Date(campaign.effectiveTo);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let total = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const weekday = cursor.getUTCDay();
    for (const schedule of campaign.schedules || []) {
      if (schedule.weekday !== weekday) continue;
      if (schedule.windowMode === "EXACT_TIME") total += 1;
      else {
        const minutes = schedule.endMinute > schedule.startMinute
          ? schedule.endMinute - schedule.startMinute
          : 1440 - schedule.startMinute + schedule.endMinute;
        total += schedule.windowMode === "INTERVAL"
          ? Math.ceil(minutes / schedule.intervalMinutes)
          : Math.floor((minutes * schedule.playsPerHour) / 60);
      }
    }
  }
  return total;
}
