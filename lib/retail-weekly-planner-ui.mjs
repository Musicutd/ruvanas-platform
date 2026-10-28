import { parseProgrammeScheduleInput } from "./advanced-scheduler.mjs";
import { schedulerLocalInput, schedulerPayloadItem, schedulerPreviewDays } from "./scheduler-form-time.mjs";

export const RETAIL_PLANNER_STATION_ID = "cmvmg7rp1000flf2kelb1kzax";
export const retailWeeklyEmptyItem = () => ({ label: "Music programme", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId: "", weekday: 1, startTime: "09:00", startsAt: "", durationMinutes: 60, priority: 50 });

const minuteOfDay = time => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null;
const clockTime = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// Half-hour choices are a convenience, not a new restriction on existing plans.
// Keep a saved time such as 09:15 selectable rather than rounding it silently.
export function retailHalfHourChoices(currentTime = "") {
  const choices = Array.from({ length: 48 }, (_, index) => clockTime(index * 30));
  if (minuteOfDay(currentTime) !== null && !choices.includes(currentTime)) choices.push(currentTime);
  return choices.sort().map(value => ({ value, label: value === currentTime && Number(value.slice(3)) % 30 !== 0 ? `${value} · current time` : value }));
}

export function retailProgrammeTimes(item) {
  const startTime = item?.recurrence === "ONE_OFF" ? (item.startsAt || "").split("T")[1] || "09:00" : item?.startTime || "09:00";
  const start = minuteOfDay(startTime), duration = Number(item?.durationMinutes);
  if (start === null || !Number.isInteger(duration) || duration < 1 || duration > 1440) return { startTime, endTime: "", nextDay: false, durationMinutes: null };
  return { startTime, endTime: clockTime(start + duration), nextDay: start + duration >= 1440, durationMinutes: duration };
}

export function retailDurationToEnd(startTime, endTime) {
  const start = minuteOfDay(startTime), end = minuteOfDay(endTime);
  if (start === null || end === null) throw new Error("Choose a valid start and end time.");
  // The same clock time means a full day; the UI explicitly explains this.
  return (end - start + 1440) % 1440 || 1440;
}

export function retailOneOffDateTime(item, { date, time } = {}) {
  const [existingDate = "", existingTime = "09:00"] = (item?.startsAt || "").split("T");
  const chosenDate = date === undefined ? existingDate : date;
  const chosenTime = time === undefined ? existingTime : time;
  return chosenDate || time !== undefined ? `${chosenDate}T${chosenTime}` : "";
}

export function retailPlaylistGenreSummary(source, genres = []) {
  if (!Array.isArray(source?.genreCodes) || !source.genreCodes.length) return "Genre details will appear when this playlist is available.";
  return source.genreCodes.map(code => genres.find(genre => genre.code === code)?.name || String(code).replaceAll("_", " ").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase())).join(" · ");
}

export function retailWeeklyForm(state, chosenChannelId = "") {
  const valid = state?.stationId === RETAIL_PLANNER_STATION_ID;
  const timezone = valid && state.schedule?.timezone || "Europe/Malta";
  return { channelId: valid ? state.schedule?.channelId || chosenChannelId || (state.channels?.length === 1 ? state.channels[0].id : "") : "",
    name: valid && state.schedule?.name || "Test Retail weekly plan", timezone,
    items: valid && state.draft?.items?.length ? state.draft.items.map(item => ({
      label: item.label, recurrence: item.recurrence, sourceType: "MUSIC_MODE", sourceId: item.sourceId,
      weekday: item.weekday ?? 1, startTime: item.startTime || "09:00",
      startsAt: item.startsAt ? schedulerLocalInput(item.startsAt, timezone) : "",
      originalStartsAt: item.startsAt || null, originalTimezone: timezone,
      durationMinutes: item.durationMinutes, priority: item.priority ?? 50
    })) : [retailWeeklyEmptyItem()] };
}

export function retailWeeklySaveBody(form) {
  const items = (form.items || []).map(item => {
    if (item.sourceType !== "MUSIC_MODE") throw new Error("Choose a saved Test Retail music playlist.");
    const converted = schedulerPayloadItem(item, form.timezone);
    return { label: converted.label, recurrence: converted.recurrence, sourceType: "MUSIC_MODE", sourceId: converted.sourceId,
      weekday: converted.recurrence === "WEEKLY" ? Number(converted.weekday) : null,
      startTime: converted.recurrence === "WEEKLY" ? converted.startTime : null,
      startsAt: converted.startsAt, durationMinutes: Number(converted.durationMinutes), priority: Number(converted.priority) };
  });
  const data = { channelId: form.channelId, name: form.name, timezone: form.timezone, items };
  const parsed = parseProgrammeScheduleInput(data);
  if (!parsed.ok) throw new Error(parsed.error);
  return { action: "save", ...data };
}

export function retailWeeklyFormSnapshot(form) {
  return JSON.stringify({ channelId: form.channelId, name: form.name, timezone: form.timezone,
    items: (form.items || []).map(item => ({ label: item.label, sourceType: item.sourceType, sourceId: item.sourceId,
      recurrence: item.recurrence, weekday: String(item.weekday ?? ""), startTime: item.startTime || "", startsAt: item.startsAt || "",
      durationMinutes: String(item.durationMinutes), priority: String(item.priority) })) });
}

// Presentation only: an approval belongs to an exact saved version, not its
// display number. Never infer approval from matching version numbers alone.
export function retailWeeklySavedApproved(state) {
  return state?.stationId === RETAIL_PLANNER_STATION_ID && state.approved?.enabled === true &&
    Boolean(state.draft?.id) && state.approved.versionId === state.draft.id &&
    Boolean(state.schedule?.channelId) && state.approved.channelId === state.schedule.channelId;
}

export function retailWeeklyDraftStatus(state, unsaved = false) {
  if (unsaved) return { label: "Unsaved changes", detail: "Save a new draft before administrator review. The currently approved week stays unchanged." };
  if (!state?.draft?.id) return { label: "No saved draft", detail: "Choose a playlist and programme time, then save your first draft for review." };
  if (retailWeeklySavedApproved(state)) return { label: `Approved version ${state.draft.version}`, detail: "This saved version is approved for broadcast from the effective time shown above. New edits need separate approval. This is not proof of live audio." };
  return { label: `Saved draft ${state.draft.version}`, detail: `Saved version ${state.draft.version} is available for administrator review. Live schedule status is managed separately by your administrator.` };
}


export function retailWeeklyDays(state) {
  const preview = state?.draft?.preview;
  if (state?.stationId !== RETAIL_PLANNER_STATION_ID || !preview || preview.timezone !== state.schedule?.timezone ||
      !Number.isFinite(Date.parse(preview.startsAt)) || !Number.isFinite(Date.parse(preview.endsAt)) ||
      Date.parse(preview.endsAt) <= Date.parse(preview.startsAt)) return [];
  try { return schedulerPreviewDays(preview); } catch { return []; }
}
