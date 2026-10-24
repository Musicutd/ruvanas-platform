// Display-only, browser-safe projection. No playback controls or network access.
import { TEST_RADIO_PLANNER_STATION_ID } from "./test-radio-weekly-planner-ui.mjs";
const text = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240) : "";
const instant = value => typeof value === "string" && Number.isFinite(Date.parse(value));
export function testRadioNowNextView(snapshot, elapsedMs = 0, failed = false) {
  const empty = { confirmed: false, label: "Source status not currently confirmed", track: null, next: null,
    planMessage: "Refresh to check the approved plan.", checkedAt: null, timezone: "Europe/Malta", warnings: [] };
  if (failed || snapshot?.stationId !== TEST_RADIO_PLANNER_STATION_ID || !instant(snapshot.checkedAt) ||
      !Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(snapshot.requestAgeMs ?? 0) || (snapshot.requestAgeMs ?? 0) < 0) return empty;
  let timezone = typeof snapshot.timezone === "string" ? snapshot.timezone : "Europe/Malta";
  try { new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(); } catch { timezone = "Europe/Malta"; }
  const age = elapsedMs + (snapshot.requestAgeMs ?? 0), source = snapshot.source;
  const confirmed = source?.confirmed === true && ["RANDOM", "SCHEDULED"].includes(source.phase) &&
    Number.isFinite(source.expiresInMs) && Math.min(15_000, source.expiresInMs) > age && instant(source.observedAt);
  const next = snapshot.plan?.next, plannedTime = instant(next?.startsAt) ? Date.parse(next.startsAt) - Date.parse(snapshot.checkedAt) : -1;
  const planFresh = age < 300_000 && (plannedTime < 0 || plannedTime > age);
  return { ...empty, confirmed, checkedAt: snapshot.checkedAt, timezone,
    label: confirmed ? text(source.label) || "Recent source report" : age >= (source?.expiresInMs || 0) && source?.confirmed ? "Source report expired — refresh to confirm" : text(source?.label) || empty.label,
    track: confirmed && text(source.track?.title) ? { title: text(source.track.title), artist: text(source.track.artist) } : null,
    next: planFresh && ["PROGRAMME", "RANDOM"].includes(next?.kind) && plannedTime > age ? {
      kind: next.kind, label: text(next.label), startsAt: next.startsAt, endsAt: instant(next.endsAt) ? next.endsAt : null
    } : null,
    planMessage: !planFresh ? "The plan snapshot needs refreshing; a handover may have occurred." : snapshot.plan?.enabled
      ? "No later handover found in the next two calendar days. Random AutoDJ fills unscheduled time while enabled."
      : "No usable approved schedule is confirmed. Draft programmes are not on air.",
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings.filter(value => typeof value === "string").slice(0, 10).map(text) : [] };
}
