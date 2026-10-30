import { normaliseRetailCommercialDraft, normaliseRetailCommercialRule, retailCommercialRuleDescription, simulateRetailCommercialRule } from "./retail-commercial-policy.mjs";
import { RETAIL_PLANNER_STATION_ID } from "./retail-weekly-planner-ui.mjs";

export const RETAIL_COMMERCIAL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const emptyRetailCommercialRule = (number = 1) => ({ name: `Shop messages ${number}`, mode: "EVERY_SONGS", everySongs: 3, everyMinutes: 10,
  weekdays: [0, 1, 2, 3, 4, 5, 6], spotIds: [], times: ["09:00"], hours: Array.from({ length: 24 }, (_, hour) => hour), startsOn: null, endsOn: null });
export const emptyRetailCommercialForm = () => ({ name: "Shop messages", timezone: "Europe/Malta", rules: [] });
export function retailCommercialForm(dto) { return dto?.draft ? { name: dto.draft.name, timezone: dto.draft.timezone, rules: dto.draft.rules.map(rule => ({ ...emptyRetailCommercialRule(), ...rule })) } : emptyRetailCommercialForm(); }
export function retailCommercialSnapshot(form) { return JSON.stringify(form); }
export function retailCommercialView(body) {
  const text = value => typeof value === "string" && value.length <= 300;
  const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/.test(value);
  if (body?.stationId !== RETAIL_PLANNER_STATION_ID || body.draftOnly !== true || body.playbackConnected !== false || body.adminApprovalRequired !== false || body.subscriberApprovalRequired !== true || body.scheduleApprovalRequired !== "SUBSCRIBER" ||
      !Array.isArray(body.spots) || body.spots.length > 100 || body.spots.some(spot => !id(spot.id) || !text(spot.name) || !Number.isInteger(spot.version) || spot.version < 1 || !Number.isFinite(spot.durationSeconds) || spot.durationSeconds <= 0 || spot.durationSeconds > 600) ||
      new Set(body.spots.map(spot => spot.id)).size !== body.spots.length || body.draft && (!id(body.draft.id) || !Number.isInteger(body.draft.version) || body.draft.version < 1 || !Number.isFinite(Date.parse(body.draft.savedAt))))
    throw new Error("The Retail commercial draft could not be verified. Refresh before editing.");
  return { stationId: body.stationId, draftOnly: true, playbackConnected: false, adminApprovalRequired: false, subscriberApprovalRequired: true, scheduleApprovalRequired: "SUBSCRIBER",
    spots: body.spots.map(({ id, name, version, durationSeconds }) => ({ id, name, version, durationSeconds })),
    draft: body.draft ? { ...normaliseRetailCommercialDraft({ name: body.draft.name, timezone: body.draft.timezone, rules: body.draft.rules }), id: body.draft.id, version: body.draft.version, savedAt: body.draft.savedAt,
      needsReview: body.draft.needsReview === true, unavailableSpotIds: (Array.isArray(body.draft.unavailableSpotIds) ? body.draft.unavailableSpotIds : []).filter(id).slice(0, 100), expiredRuleNames: (Array.isArray(body.draft.expiredRuleNames) ? body.draft.expiredRuleNames : []).filter(text).slice(0, 20) } : null,
    warnings: (Array.isArray(body.warnings) ? body.warnings : []).filter(text).slice(0, 20) };
}
export function retailCommercialIssues(form, spots) {
  if (!form.name.trim()) return ["Give this commercial plan a name."];
  const issues = [];
  for (const [index, rule] of form.rules.entries()) {
    const prefix = `Break ${index + 1}: `;
    if (!rule.spotIds.length) issues.push(prefix + "choose at least one approved spot.");
    else if (rule.spotIds.some(id => !spots.some(spot => spot.id === id))) issues.push(prefix + "a selected spot is no longer available. Remove or replace it.");
    if (!rule.weekdays.length) issues.push(prefix + "choose at least one day.");
    if (rule.mode === "SCHEDULED" && !rule.times.length) issues.push(prefix + "add a scheduled time.");
    if (rule.mode === "TOP_OF_HOUR" && !rule.hours.length) issues.push(prefix + "select the hours to use.");
    if (rule.spotIds.reduce((sum, id) => sum + (spots.find(spot => spot.id === id)?.durationSeconds || 0), 0) > 600) issues.push(prefix + "keep this break within 10 minutes.");
    try { normaliseRetailCommercialRule(rule); } catch { if (!issues.some(issue => issue.startsWith(prefix))) issues.push(prefix + "check its name, frequency and dates."); }
  }
  if (!issues.length) try { normaliseRetailCommercialDraft(form); } catch { issues.push("Use a different name for each break, and check the plan name and number of rules."); }
  return issues;
}
export function retailCommercialSummary(rule) {
  try { return retailCommercialRuleDescription(rule); } catch { return "Choose a spot and complete the timing below."; }
}
export function retailCommercialPattern(rule, spots) {
  try { return simulateRetailCommercialRule(rule, { songs: 9, minutes: 1440, weekday: rule.weekdays[0] ?? 1, startTime: "00:00", spots, maxEvents: 8 }); } catch { return null; }
}
export function retailCommercialSaveBody(form, { requestId, baseVersionId }) { return { action: "save", ...normaliseRetailCommercialDraft(form), requestId, baseVersionId }; }
