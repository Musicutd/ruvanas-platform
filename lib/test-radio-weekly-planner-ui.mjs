import { parseProgrammeScheduleInput } from "./advanced-scheduler.mjs";
import { schedulerLocalInput, schedulerPayloadItem, schedulerPreviewDays } from "./scheduler-form-time.mjs";

export const TEST_RADIO_PLANNER_STATION_ID = "cmvcnbwi20008hr23sd76psi8";
export const testRadioWeeklyEmptyItem = () => ({ label: "Music programme", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId: "", weekday: 1, startTime: "09:00", startsAt: "", durationMinutes: 60, priority: 50 });

export function testRadioWeeklyForm(state, chosenChannelId = "") {
  const valid = state?.stationId === TEST_RADIO_PLANNER_STATION_ID;
  const timezone = valid && state.schedule?.timezone || "Europe/Malta";
  return { channelId: valid ? state.schedule?.channelId || chosenChannelId || (state.channels?.length === 1 ? state.channels[0].id : "") : "",
    name: valid && state.schedule?.name || "Test Radio weekly plan", timezone,
    items: valid && state.draft?.items?.length ? state.draft.items.map(item => ({
      label: item.label, recurrence: item.recurrence, sourceType: "MUSIC_MODE", sourceId: item.sourceId,
      weekday: item.weekday ?? 1, startTime: item.startTime || "09:00",
      startsAt: item.startsAt ? schedulerLocalInput(item.startsAt, timezone) : "",
      originalStartsAt: item.startsAt || null, originalTimezone: timezone,
      durationMinutes: item.durationMinutes, priority: item.priority ?? 50
    })) : [testRadioWeeklyEmptyItem()] };
}

export function testRadioWeeklySaveBody(form) {
  const items = (form.items || []).map(item => {
    if (item.sourceType !== "MUSIC_MODE") throw new Error("Choose a saved Test Radio music playlist.");
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

export function testRadioWeeklyFormSnapshot(form) {
  return JSON.stringify({ channelId: form.channelId, name: form.name, timezone: form.timezone,
    items: (form.items || []).map(item => ({ label: item.label, sourceType: item.sourceType, sourceId: item.sourceId,
      recurrence: item.recurrence, weekday: String(item.weekday ?? ""), startTime: item.startTime || "", startsAt: item.startsAt || "",
      durationMinutes: String(item.durationMinutes), priority: String(item.priority) })) });
}

// Presentation only: an approval belongs to an exact saved version, not its
// display number. Never infer approval from matching version numbers alone.
export function testRadioWeeklySavedApproved(state) {
  return state?.stationId === TEST_RADIO_PLANNER_STATION_ID && state.approved?.enabled === true &&
    Boolean(state.draft?.id) && state.approved.versionId === state.draft.id &&
    Boolean(state.schedule?.channelId) && state.approved.channelId === state.schedule.channelId;
}

export function testRadioWeeklyDraftStatus(state, unsaved = false) {
  if (unsaved) return { label: "Unsaved changes", detail: "Save a new draft before administrator review. The currently approved week stays unchanged." };
  if (!state?.draft?.id) return { label: "No saved draft", detail: "Choose a playlist and programme time, then save your first draft for review." };
  if (testRadioWeeklySavedApproved(state)) return { label: `Approved version ${state.draft.version}`, detail: "This saved version is approved for broadcast from the effective time shown above. New edits need separate approval. This is not proof of live audio." };
  return { label: `Draft ${state.draft.version} · awaiting admin approval`, detail: `Saved version ${state.draft.version} is awaiting administrator approval. It does not replace the currently approved week.` };
}

export function testRadioWeeklyApprovalBody({ state, form, reviewHash, reviewed, overridesAcknowledged, draftOnly = false }) {
  if (draftOnly || state?.canApprove === false || state?.stationId !== TEST_RADIO_PLANNER_STATION_ID || state.canEdit !== true || state.draft?.readyToApprove !== true ||
      reviewed !== true || overridesAcknowledged !== true || !state.draft?.id ||
      !/^[a-f0-9]{64}$/.test(reviewHash || "") || reviewHash !== state.draft.reviewHash ||
      !state.schedule?.channelId || state.schedule.channelId !== form?.channelId ||
      !testRadioWeeklyDays(state).length ||
      testRadioWeeklyFormSnapshot(form) !== testRadioWeeklyFormSnapshot(testRadioWeeklyForm(state))) return null;
  return { action: "approve", channelId: state.schedule.channelId, versionId: state.draft.id, reviewHash, overridesAcknowledged: true };
}

export function testRadioWeeklyDays(state) {
  const preview = state?.draft?.preview;
  if (state?.stationId !== TEST_RADIO_PLANNER_STATION_ID || !preview || preview.timezone !== state.schedule?.timezone ||
      !Number.isFinite(Date.parse(preview.startsAt)) || !Number.isFinite(Date.parse(preview.endsAt)) ||
      Date.parse(preview.endsAt) <= Date.parse(preview.startsAt)) return [];
  try { return schedulerPreviewDays(preview); } catch { return []; }
}
