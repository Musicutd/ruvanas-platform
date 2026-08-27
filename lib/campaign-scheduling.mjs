import crypto from "node:crypto";
import { parseLocalTime } from "./opening-hours.mjs";

export const MAX_CAMPAIGN_TARGETS = 100;
export const MAX_CAMPAIGN_SCHEDULES = 200;
export const MAX_CAMPAIGN_DAYS = 366;

const TARGET_TYPES = new Set([
  "ALL_LOCATIONS",
  "BRAND",
  "LOCATION_GROUP",
  "LOCATION",
  "ZONE"
]);
const SCHEDULING_MODES = new Set([
  "PLAYS_PER_HOUR",
  "INTERVAL",
  "EXACT_TIMES",
  "ADVANCED_DAYPART",
  "SMART_PRIORITY"
]);
const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "VERY_HIGH"]);
const SMART_PLAYS_PER_HOUR = Object.freeze({ LOW: 1, NORMAL: 2, HIGH: 4, VERY_HIGH: 6 });

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value, { min, max, label }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function dateValue(value, label) {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be a real calendar date.`);
  }
  return text;
}

function minuteValue(value, label) {
  const minute = parseLocalTime(value);
  if (minute === null) throw new Error(`${label} must use a valid 24-hour time.`);
  return minute;
}

function expandedSegments(schedule) {
  if (schedule.windowMode === "EXACT_TIME") {
    return [{ weekday: schedule.weekday, start: schedule.exactMinute, end: schedule.exactMinute + 1 }];
  }
  if (schedule.endMinute > schedule.startMinute) {
    return [{ weekday: schedule.weekday, start: schedule.startMinute, end: schedule.endMinute }];
  }
  return [
    { weekday: schedule.weekday, start: schedule.startMinute, end: 1440 },
    { weekday: (schedule.weekday + 1) % 7, start: 0, end: schedule.endMinute }
  ];
}

function validateScheduleOverlaps(schedules) {
  const segments = schedules.flatMap((schedule, index) =>
    expandedSegments(schedule).map((segment) => ({ ...segment, index }))
  );
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const a = segments[left];
      const b = segments[right];
      if (a.index !== b.index && a.weekday === b.weekday && a.start < b.end && b.start < a.end) {
        throw new Error("Campaign schedule windows cannot overlap, including overnight carry-over.");
      }
    }
  }
}

function normaliseTargets(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CAMPAIGN_TARGETS) {
    throw new Error(`Choose between 1 and ${MAX_CAMPAIGN_TARGETS} campaign targets.`);
  }
  const targets = value.map((target, index) => {
    const targetType = cleanText(target?.targetType).toUpperCase();
    const targetId = cleanText(target?.targetId);
    if (!TARGET_TYPES.has(targetType)) throw new Error(`Target ${index + 1} has an invalid type.`);
    if (targetType !== "ALL_LOCATIONS" && !targetId) throw new Error(`Target ${index + 1} needs a selection.`);
    return { targetType, targetId: targetType === "ALL_LOCATIONS" ? null : targetId };
  });
  if (targets.some((target) => target.targetType === "ALL_LOCATIONS") && targets.length > 1) {
    throw new Error("All locations already includes every brand, group, location, and zone.");
  }
  const unique = new Map(targets.map((target) => [`${target.targetType}:${target.targetId || "all"}`, target]));
  return [...unique.values()];
}

function normaliseSchedules(value, { mode, priority, playsPerHour, intervalMinutes }) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CAMPAIGN_SCHEDULES) {
    throw new Error(`Add between 1 and ${MAX_CAMPAIGN_SCHEDULES} campaign schedule entries.`);
  }
  const schedules = value.map((entry, index) => {
    const weekday = integer(entry?.weekday, { min: 0, max: 6, label: `Schedule ${index + 1} weekday` });
    if (mode === "EXACT_TIMES") {
      return {
        weekday,
        windowMode: "EXACT_TIME",
        startMinute: null,
        endMinute: null,
        exactMinute: minuteValue(entry?.at, `Schedule ${index + 1} exact time`),
        playsPerHour: null,
        intervalMinutes: null
      };
    }

    const startMinute = minuteValue(entry?.startsAt, `Schedule ${index + 1} start`);
    const endMinute = minuteValue(entry?.endsAt, `Schedule ${index + 1} end`);
    if (startMinute === endMinute) throw new Error(`Schedule ${index + 1} needs different start and end times.`);

    let windowMode = mode === "INTERVAL" ? "INTERVAL" : "PLAYS_PER_HOUR";
    let windowPlays = playsPerHour;
    let windowInterval = intervalMinutes;

    if (mode === "SMART_PRIORITY") windowPlays = SMART_PLAYS_PER_HOUR[priority];
    if (mode === "ADVANCED_DAYPART") {
      windowMode = cleanText(entry?.frequencyMode).toUpperCase();
      if (!new Set(["PLAYS_PER_HOUR", "INTERVAL"]).has(windowMode)) {
        throw new Error(`Schedule ${index + 1} needs a plays-per-hour or interval rule.`);
      }
      if (windowMode === "PLAYS_PER_HOUR") {
        windowPlays = integer(entry?.playsPerHour, { min: 1, max: 12, label: `Schedule ${index + 1} plays per hour` });
        windowInterval = null;
      } else {
        windowInterval = integer(entry?.intervalMinutes, { min: 5, max: 180, label: `Schedule ${index + 1} interval` });
        windowPlays = null;
      }
    }

    return {
      weekday,
      windowMode,
      startMinute,
      endMinute,
      exactMinute: null,
      playsPerHour: windowMode === "PLAYS_PER_HOUR" ? windowPlays : null,
      intervalMinutes: windowMode === "INTERVAL" ? windowInterval : null
    };
  });
  validateScheduleOverlaps(schedules);
  return schedules;
}

export function normaliseCampaignPayload(body) {
  const name = cleanText(body?.name);
  const organisationId = cleanText(body?.organisationId);
  const promoVersionId = cleanText(body?.promoVersionId);
  const schedulingMode = cleanText(body?.schedulingMode).toUpperCase();
  const priority = cleanText(body?.priority || "NORMAL").toUpperCase();
  if (!organisationId) throw new Error("Choose an organisation.");
  if (!promoVersionId) throw new Error("Choose an approved promotional version.");
  if (!name || name.length > 120) throw new Error("Campaign name must contain between 1 and 120 characters.");
  if (!SCHEDULING_MODES.has(schedulingMode)) throw new Error("Choose a valid scheduling mode.");
  if (!PRIORITIES.has(priority)) throw new Error("Choose a valid campaign priority.");

  const effectiveFrom = dateValue(body?.effectiveFrom, "Campaign start date");
  const effectiveTo = dateValue(body?.effectiveTo, "Campaign end date");
  if (effectiveTo < effectiveFrom) throw new Error("Campaign end date cannot be before its start date.");
  const days = Math.floor((new Date(`${effectiveTo}T00:00:00.000Z`) - new Date(`${effectiveFrom}T00:00:00.000Z`)) / 86400000) + 1;
  if (days > MAX_CAMPAIGN_DAYS) throw new Error(`Campaigns may span at most ${MAX_CAMPAIGN_DAYS} days.`);

  const playsPerHour = schedulingMode === "PLAYS_PER_HOUR"
    ? integer(body?.playsPerHour, { min: 1, max: 12, label: "Plays per hour" })
    : null;
  const intervalMinutes = schedulingMode === "INTERVAL"
    ? integer(body?.intervalMinutes, { min: 5, max: 180, label: "Interval" })
    : null;

  const campaign = {
    organisationId,
    promoVersionId,
    name,
    priority,
    schedulingMode,
    mandatory: body?.mandatory === true,
    respectOpeningHours: body?.respectOpeningHours !== false,
    effectiveFrom,
    effectiveTo,
    maxPromoMinutesPerHour: integer(body?.maxPromoMinutesPerHour ?? 12, { min: 1, max: 60, label: "Maximum promotional minutes per hour" }),
    minSamePromoGapMinutes: integer(body?.minSamePromoGapMinutes ?? 15, { min: 1, max: 720, label: "Same-promo gap" }),
    minAnyPromoGapMinutes: integer(body?.minAnyPromoGapMinutes ?? 2, { min: 0, max: 720, label: "Any-promo gap" }),
    exactTimeHardStart: body?.exactTimeHardStart === true,
    playsPerHour,
    intervalMinutes,
    targets: normaliseTargets(body?.targets),
    schedules: []
  };
  campaign.schedules = normaliseSchedules(body?.schedules, {
    mode: campaign.schedulingMode,
    priority: campaign.priority,
    playsPerHour: campaign.playsPerHour,
    intervalMinutes: campaign.intervalMinutes
  });
  return campaign;
}

export function expandCampaignTargets({ targets, brands = [], groups = [], locations = [], zones = [] }) {
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const brandIds = new Set(brands.map((brand) => brand.id));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const selectedLocationIds = new Set();
  const selectedZoneIds = new Set();

  for (const target of targets) {
    if (target.targetType === "ALL_LOCATIONS") locations.forEach((location) => selectedLocationIds.add(location.id));
    if (target.targetType === "BRAND") {
      if (!brandIds.has(target.targetId)) throw new Error("A selected brand does not belong to this organisation.");
      locations.filter((location) => location.brandId === target.targetId).forEach((location) => selectedLocationIds.add(location.id));
    }
    if (target.targetType === "LOCATION_GROUP") {
      const group = groupById.get(target.targetId);
      if (!group) throw new Error("A selected location group does not belong to this organisation.");
      (group.locationIds || []).forEach((locationId) => selectedLocationIds.add(locationId));
    }
    if (target.targetType === "LOCATION") {
      if (!locationById.has(target.targetId)) throw new Error("A selected location does not belong to this organisation.");
      selectedLocationIds.add(target.targetId);
    }
    if (target.targetType === "ZONE") {
      if (!zoneById.has(target.targetId)) throw new Error("A selected zone does not belong to this organisation.");
      selectedZoneIds.add(target.targetId);
    }
  }

  zones.forEach((zone) => {
    if (selectedLocationIds.has(zone.locationId)) selectedZoneIds.add(zone.id);
  });

  return [...selectedZoneIds].sort().map((zoneId) => {
    const zone = zoneById.get(zoneId);
    const location = locationById.get(zone.locationId);
    return {
      id: zone.id,
      name: `${location?.name || "Location"} / ${zone.name}`,
      locationId: zone.locationId,
      timezone: location?.timezone || "UTC",
      openingHoursConfigured: Boolean(location?.openingHoursConfigured)
    };
  });
}

function schedulePlays(schedule) {
  if (schedule.windowMode === "EXACT_TIME") return 1;
  const minutes = schedule.endMinute > schedule.startMinute
    ? schedule.endMinute - schedule.startMinute
    : 1440 - schedule.startMinute + schedule.endMinute;
  if (schedule.windowMode === "INTERVAL") return Math.ceil(minutes / schedule.intervalMinutes);
  return Math.floor((minutes * schedule.playsPerHour) / 60);
}

function schedulesOverlap(left, right) {
  return expandedSegments(left).some((a) => expandedSegments(right).some((b) =>
    a.weekday === b.weekday && a.start < b.end && b.start < a.end
  ));
}

function dateRangesOverlap(left, right) {
  return left.effectiveFrom <= right.effectiveTo && right.effectiveFrom <= left.effectiveTo;
}

function maxHourlyRate(schedule) {
  if (schedule.windowMode === "EXACT_TIME") return 1;
  if (schedule.windowMode === "INTERVAL") return Math.ceil(60 / schedule.intervalMinutes);
  return schedule.playsPerHour;
}

export function previewCampaign({ campaign, durationSeconds, targetZones = [], existingCampaigns = [] }) {
  const errors = [];
  const warnings = [];
  if (!targetZones.length) errors.push("The selected targets do not contain any playback zones.");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    warnings.push("The approved promo has no verified duration, so the hourly minutes guardrail cannot be fully checked.");
  }
  if (campaign.respectOpeningHours && targetZones.some((zone) => !zone.openingHoursConfigured)) {
    warnings.push("One or more targeted locations have no opening hours configured; those locations will be treated as open.");
  }

  for (const schedule of campaign.schedules) {
    const rate = maxHourlyRate(schedule);
    const cadence = schedule.windowMode === "INTERVAL" ? schedule.intervalMinutes : 60 / rate;
    if (cadence < campaign.minSamePromoGapMinutes) {
      errors.push(`A ${Math.round(cadence * 10) / 10}-minute cadence violates the ${campaign.minSamePromoGapMinutes}-minute same-promo gap.`);
    }
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      const promoMinutes = (durationSeconds / 60) * rate;
      if (promoMinutes > campaign.maxPromoMinutesPerHour) {
        errors.push(`This rule may use ${promoMinutes.toFixed(1)} promo minutes per hour, above the ${campaign.maxPromoMinutesPerHour}-minute limit.`);
      }
    }
  }

  const targetIds = new Set(targetZones.map((zone) => zone.id));
  for (const existing of existingCampaigns) {
    if (!dateRangesOverlap(campaign, existing)) continue;
    if (!(existing.targetZoneIds || []).some((id) => targetIds.has(id))) continue;
    if (!(existing.schedules || []).some((left) => campaign.schedules.some((right) => schedulesOverlap(left, right)))) continue;
    warnings.push(`${existing.mandatory ? "Mandatory campaign" : "Campaign"} “${existing.name}” overlaps at least one target and time window.`);
  }

  const start = new Date(`${campaign.effectiveFrom}T00:00:00.000Z`);
  const end = new Date(`${campaign.effectiveTo}T00:00:00.000Z`);
  let estimatedPlaysPerZone = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
    const weekday = cursor.getUTCDay();
    estimatedPlaysPerZone += campaign.schedules
      .filter((schedule) => schedule.weekday === weekday)
      .reduce((total, schedule) => total + schedulePlays(schedule), 0);
  }

  return {
    canPublish: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    targetZoneCount: targetZones.length,
    estimatedPlaysPerZone,
    estimatedTotalPlays: estimatedPlaysPerZone * targetZones.length,
    activeDays: Math.floor((end - start) / 86400000) + 1
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function campaignConfigurationHash(campaign) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(campaign))).digest("hex");
}

export function campaignTargetCreateData(target) {
  return {
    targetType: target.targetType,
    brandId: target.targetType === "BRAND" ? target.targetId : null,
    locationGroupId: target.targetType === "LOCATION_GROUP" ? target.targetId : null,
    locationId: target.targetType === "LOCATION" ? target.targetId : null,
    zoneId: target.targetType === "ZONE" ? target.targetId : null
  };
}
