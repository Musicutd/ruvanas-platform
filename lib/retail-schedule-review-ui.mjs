import { schedulerLocalInput, schedulerOneOffInstant, schedulerPreviewDays } from "./scheduler-form-time.mjs";

export const RETAIL_REVIEW_ORGANISATION_ID = "cmvmeq5880005lf2knwtw1b93";
export const RETAIL_REVIEW_STATION_ID = "cmvmg7rp1000flf2kelb1kzax";
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const text = (value, max = 240) => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const invalid = () => { throw new Error("The saved Retail schedule could not be verified. Refresh before reviewing or approving it."); };
const timestamp = value => {
  if (value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid();
  return new Date(value).toISOString();
};
const strings = value => {
  if (!Array.isArray(value) || value.length > 200 || value.some(item => !text(item, 1000))) invalid();
  return [...value];
};

// The owner view is an explicit projection: credentials, private paths and
// worker instructions never become browser state through this decoder.
export function retailScheduleReviewView(raw, organisationId) {
  if (organisationId !== RETAIL_REVIEW_ORGANISATION_ID || raw?.organisationId !== organisationId || raw.stationId !== RETAIL_REVIEW_STATION_ID ||
      raw.channelId != null && !id(raw.channelId) || !Array.isArray(raw.sources) || raw.sources.length > 20 ||
      raw.highestVersionId != null && !id(raw.highestVersionId) || typeof raw.canApprove !== "boolean" || typeof raw.canPrepareTest !== "boolean") invalid();
  const sources = raw.sources.map(source => {
    if (!id(source?.id) || !text(source.name) || !Number.isInteger(source.eligibleTrackCount) || source.eligibleTrackCount < 0 || source.eligibleTrackCount > 2000) invalid();
    return { id: source.id, name: source.name, eligibleTrackCount: source.eligibleTrackCount,
      readyForSchedule: source.eligibleTrackCount > 0 && source.eligibleTrackCount <= 64 };
  });
  if (new Set(sources.map(source => source.id)).size !== sources.length) invalid();
  let schedule = null, draft = null, approved = null, observation = null;
  if (raw.schedule != null) {
    if (!id(raw.schedule.id) || raw.schedule.channelId !== raw.channelId || !text(raw.schedule.name, 120) || !text(raw.schedule.timezone, 80)) invalid();
    try { new Intl.DateTimeFormat("en-GB", { timeZone: raw.schedule.timezone }).format(); } catch { invalid(); }
    schedule = { id: raw.schedule.id, channelId: raw.channelId, name: raw.schedule.name, timezone: raw.schedule.timezone };
  }
  if (raw.draft != null) {
    const item = raw.draft;
    if (!schedule || !id(item.id) || !Number.isSafeInteger(item.version) || item.version < 1 || typeof item.readyToApprove !== "boolean" ||
        item.reviewHash != null && !hash(item.reviewHash) || !Array.isArray(item.items) || item.items.length > 200) invalid();
    let preview = null;
    if (item.preview != null) {
      const value = item.preview, startsAt = timestamp(value.startsAt), endsAt = timestamp(value.endsAt);
      if (value.timezone !== schedule.timezone || !startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt) ||
          !Number.isInteger(value.days) || value.days < 1 || value.days > 31 || !Array.isArray(value.occurrences) || value.occurrences.length > 6200) invalid();
      const occurrences = value.occurrences.map(event => {
        const start = timestamp(event.startsAt), end = timestamp(event.endsAt);
        if (!id(event.sourceId) || !text(event.label) || !start || !end || Date.parse(end) <= Date.parse(start) ||
            !Number.isInteger(event.priority) || event.priority < 0 || event.priority > 100) invalid();
        return { sourceId: event.sourceId, label: event.label, startsAt: start, endsAt: end, priority: event.priority };
      });
      preview = { timezone: value.timezone, startsAt, endsAt, days: value.days, occurrences, warnings: strings(value.warnings || []) };
    }
    const preservedDraftVersionId = item.preservedDraftVersionId ?? null;
    if (preservedDraftVersionId !== null && !id(preservedDraftVersionId)) invalid();
    const items = item.items.map(row => {
      if (!text(row.label) || row.sourceType !== "MUSIC_MODE" || !id(row.sourceId) || !["WEEKLY", "ONE_OFF"].includes(row.recurrence) ||
          !Number.isInteger(row.durationMinutes) || row.durationMinutes < 1 || row.durationMinutes > 10080 ||
          !Number.isInteger(row.priority) || row.priority < 0 || row.priority > 100) invalid();
      const startsAt = timestamp(row.startsAt);
      if (row.recurrence === "WEEKLY" && (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime || "")) ||
          row.recurrence === "ONE_OFF" && !startsAt) invalid();
      return { label: row.label, sourceId: row.sourceId, recurrence: row.recurrence, durationMinutes: row.durationMinutes,
        priority: row.priority, weekday: row.weekday, startTime: row.startTime, startsAt };
    });
    draft = { id: item.id, version: item.version, reviewHash: item.reviewHash || null, readyToApprove: item.readyToApprove,
      preview, items, itemCount: items.length, diagnostic: item.diagnostic === true, preservedDraftVersionId };
    if (draft.readyToApprove && (!draft.preview || !draft.reviewHash || !draft.itemCount)) invalid();
  }
  if (raw.approved != null) {
    const value = raw.approved;
    if (typeof value.enabled !== "boolean" || value.channelId !== raw.channelId || !id(value.versionId) || !Number.isSafeInteger(value.version) || value.version < 1) invalid();
    approved = { enabled: value.enabled, versionId: value.versionId || null, version: value.version || null,
      diagnostic: value.diagnostic === true, publishedAt: timestamp(value.publishedAt), effectiveAt: timestamp(value.effectiveAt) };
  }
  if (raw.observation != null) {
    const value = raw.observation;
    if (!text(value.state, 40) || typeof value.fresh !== "boolean" || !["RANDOM", "SCHEDULED", "UNKNOWN", null, undefined].includes(value.phase)) invalid();
    let track = null;
    if (value.track != null) {
      if (!text(value.track.title) || !text(value.track.artist)) invalid();
      track = { title: value.track.title, artist: value.track.artist };
    }
    let programme = null;
    if (value.programme != null) {
      if (!text(value.programme.label) || value.programme.occurrenceId != null && !hash(value.programme.occurrenceId) ||
          value.programme.scheduleRevision != null && !hash(value.programme.scheduleRevision)) invalid();
      programme = { label: value.programme.label, startsAt: timestamp(value.programme.startsAt), endsAt: timestamp(value.programme.endsAt),
        occurrenceId: value.programme.occurrenceId || null, scheduleRevision: value.programme.scheduleRevision || null };
    }
    const sourceLatenessMs = value.sourceLatenessMs ?? null;
    if (sourceLatenessMs !== null && (!Number.isFinite(sourceLatenessMs) || sourceLatenessMs < 0 || sourceLatenessMs > 3_600_000)) invalid();
    observation = { state: value.state, phase: value.phase || "UNKNOWN", fresh: value.fresh, observedAt: timestamp(value.observedAt),
      checkedAt: timestamp(value.checkedAt), presentationAt: timestamp(value.presentationAt), sourceLatenessMs, programme, track };
  }
  return { organisationId, stationId: raw.stationId, channelId: raw.channelId || null, sources, schedule, draft, approved, observation,
    highestVersionId: raw.highestVersionId || null, canApprove: raw.canApprove, canPrepareTest: raw.canPrepareTest,
    warnings: strings(raw.warnings || []), blockers: strings(raw.blockers || []) };
}

export function retailReviewDays(view) {
  if (view?.stationId !== RETAIL_REVIEW_STATION_ID || !view.draft?.preview) return [];
  try { return schedulerPreviewDays(view.draft.preview); } catch { return []; }
}

export function retailReviewedApproval(view, reviewed, acknowledged, requestId) {
  if (view?.organisationId !== RETAIL_REVIEW_ORGANISATION_ID || view.stationId !== RETAIL_REVIEW_STATION_ID || !view.channelId ||
      view.canApprove !== true || !view.draft?.readyToApprove || !view.draft.reviewHash || view.blockers?.length || !retailReviewDays(view).length ||
      reviewed?.versionId !== view.draft.id || reviewed?.reviewHash !== view.draft.reviewHash || acknowledged !== true ||
      view.approved?.enabled && view.approved.versionId === view.draft.id) return null;
  return { action: "approve", versionId: view.draft.id, reviewHash: view.draft.reviewHash, requestId, overridesAcknowledged: true };
}

export function retailTestDraftForm(view, now = new Date()) {
  const future = new Date(Math.ceil((now.getTime() + 5 * 60_000) / 60_000) * 60_000);
  const timezone = view?.schedule?.timezone || "Europe/Malta";
  return { sourceId: view?.sources?.find(source => source.readyForSchedule)?.id || "", durationMinutes: "2",
    startsAt: schedulerLocalInput(future, timezone), originalStartsAt: future.toISOString(), originalTimezone: timezone };
}

export function retailTestDraftRequest(view, form, requestId, now = new Date()) {
  if (view?.organisationId !== RETAIL_REVIEW_ORGANISATION_ID || view.stationId !== RETAIL_REVIEW_STATION_ID || !view.channelId ||
      view.canPrepareTest !== true || !view.sources.some(source => source.id === form.sourceId && source.readyForSchedule)) throw new Error("Choose an eligible saved Test Retail playlist before preparing a test.");
  const durationMinutes = Number(form.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 5) throw new Error("Choose a test duration from 1 to 5 minutes.");
  const startsAt = schedulerOneOffInstant(form.startsAt, view.schedule?.timezone || "Europe/Malta", form);
  if (Date.parse(startsAt) < now.getTime() + 120_000 || Date.parse(startsAt) > now.getTime() + 60 * 60_000) throw new Error("Choose a start between 2 and 60 minutes ahead, with time to review and approve the draft.");
  return { action: "prepare-test", sourceId: form.sourceId, startsAt, durationMinutes, requestId, baseVersionId: view.highestVersionId };
}

export function retailReviewSource(view, now = new Date()) {
  const value = view?.observation, age = value?.observedAt ? now.getTime() - Date.parse(value.observedAt) : Infinity;
  const fresh = value?.fresh === true && age >= 0 && age <= 15_000;
  const timing = fresh && value.state === "STREAMING" && ["RANDOM", "SCHEDULED"].includes(value.phase) ? {
    presentationAt: value.presentationAt, sourceLatenessMs: value.sourceLatenessMs, programme: value.programme
  } : null;
  return { fresh, timing, label: fresh && value.state === "STREAMING" && value.phase === "SCHEDULED" ? `Source report: ${value.programme?.label || "scheduled programme"}`
    : fresh && value.state === "STREAMING" && value.phase === "RANDOM" ? "Source report: random AutoDJ"
    : "Current programme mode is unverified", detail: fresh && value.track ? `${value.track.artist} — ${value.track.title}`
    : "Refresh for a current source report. An expired or missing report does not mean playback stopped." };
}

export function retailScheduleReviewNotice(code) {
  const value = typeof code === "string" ? code : "";
  if (/STALE|CHANGED|CONFLICT|HASH|BASE_VERSION|LATEST/.test(value)) return "The saved plan or its music changed. Refresh, review the latest saved version and confirm it again before approving.";
  if (/LEAD|TOO_SOON|PAST|START_TIME/.test(value)) return "There is not enough time left to prepare this handover. Prepare a new test draft with a later start, then review it again.";
  if (/OWNER|ADMIN|ACCESS_DENIED/.test(value)) return "Sign in as the platform owner to review and approve Test Retail’s schedule.";
  if (/SOURCE|MUSIC|RIGHT|CATALOGUE/.test(value)) return "The saved music needs a current access or eligibility review. Refresh the saved week before continuing.";
  if (/CHANNEL|WORKSPACE/.test(value)) return "The Test Retail planning channel needs review before an on-air schedule can be approved.";
  return "The schedule request could not be confirmed. Refresh the saved week before making another change.";
}
