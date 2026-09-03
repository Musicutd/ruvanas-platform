export const PROGRAMMING_WEEKDAYS = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
]);

const PROGRAMMING_MANAGER_ROLES = Object.freeze(["OWNER", "MANAGER"]);

export function canManageSubscriberProgramming(role) {
  return PROGRAMMING_MANAGER_ROLES.includes(role);
}

export function formatProgrammingTime(minute) {
  const safeMinute = Math.max(0, Math.min(1439, Number(minute) || 0));
  const hours = Math.floor(safeMinute / 60);
  const minutes = safeMinute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function buildProgrammingWeek(slots = []) {
  const days = PROGRAMMING_WEEKDAYS.map((name, weekday) => ({
    weekday,
    name,
    slots: []
  }));

  for (const slot of slots) {
    if (!Number.isInteger(slot?.weekday) || slot.weekday < 0 || slot.weekday > 6) continue;
    days[slot.weekday].slots.push({
      id: slot.id || null,
      musicModeId: slot.musicModeId,
      musicModeName: slot.musicMode?.name || slot.musicModeName || "Approved music mode",
      startsAt: slot.startsAt || formatProgrammingTime(slot.startMinute),
      endsAt: slot.endsAt || formatProgrammingTime(slot.endMinute),
      overnight: Number(slot.endMinute) <= Number(slot.startMinute)
    });
  }

  for (const day of days) {
    day.slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }
  return days;
}

export function describeProgrammingTarget(target) {
  if (!target) return "Listening area";
  return target.type === "ZONE"
    ? `${target.locationName} / ${target.name}`
    : target.name;
}

export function requirePublishPreview({ publish, previewAcknowledged }) {
  if (publish && previewAcknowledged !== true) {
    throw new Error("Review the weekly preview before publishing this schedule.");
  }
  return true;
}

function dateOnly(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function previousProgrammingDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function publishedScheduleTransition(existing, nextEffectiveFrom) {
  if (!nextEffectiveFrom) return "ARCHIVE";
  const existingFrom = dateOnly(existing?.effectiveFrom);
  const existingTo = dateOnly(existing?.effectiveTo);
  if (existingFrom && existingFrom >= nextEffectiveFrom) return "ARCHIVE";
  if (!existingTo || existingTo >= nextEffectiveFrom) return "END_BEFORE";
  return "KEEP";
}
