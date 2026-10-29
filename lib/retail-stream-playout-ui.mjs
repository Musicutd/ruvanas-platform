// Browser-safe projection. Runtime grants, provider secrets, media paths and
// worker configuration are never part of the owner setup response.
const invalid = () => { throw new Error("Retail streaming status could not be verified. Refresh its status before continuing."); };
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const bounded = (value, max = 160) => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const money = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100000;
const code = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const timestamp = value => {
  if (value == null) return null;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) invalid();
  return date.toISOString();
};

export function safeRetailPlayoutView(value, organisationId) {
  if (!id(organisationId) || value?.organisation?.id !== organisationId || !bounded(value.organisation.name) ||
    !["connectionSaved", "canPrepare", "canStart", "enabled"].every(key => typeof value[key] === "boolean") ||
    !Number.isSafeInteger(value.eligibleTrackCount) || value.eligibleTrackCount < 0 || value.eligibleTrackCount > 100000 ||
    !Array.isArray(value.availableGenres) || value.availableGenres.length > 500 || !Array.isArray(value.blockers) || value.blockers.length > 100) invalid();
  const station = value.station == null ? null : { id: value.station.id, status: value.station.status };
  if (station && (!id(station.id) || !["DRAFT", "PENDING_SETUP", "ACTIVE", "PAUSED", "SUSPENDED", "CANCELLED"].includes(station.status))) invalid();
  const prepared = value.prepared == null ? null : {
    territory: value.prepared.territory,
    genreCodes: value.prepared.genreCodes,
    preparedAt: timestamp(value.prepared.preparedAt)
  };
  if (prepared && (!/^[A-Z]{2}$/.test(prepared.territory || "") || !Array.isArray(prepared.genreCodes) ||
    prepared.genreCodes.length > 100 || prepared.genreCodes.some(item => !code(item)) ||
    new Set(prepared.genreCodes).size !== prepared.genreCodes.length || !prepared.preparedAt)) invalid();
  const genres = value.availableGenres.map(item => {
    if (!code(item?.code) || !bounded(item.name, 100)) invalid();
    return { code: item.code, name: item.name };
  });
  if (new Set(genres.map(item => item.code)).size !== genres.length) invalid();
  const rawCapacity = value.capacity;
  if (!rawCapacity || typeof rawCapacity.assigned !== "boolean") invalid();
  const capacity = { assigned: rawCapacity.assigned,
    monthlyBudgetUsd: rawCapacity.monthlyBudgetUsd ?? null,
    estimatedMonthlyUsd: rawCapacity.estimatedMonthlyUsd ?? null,
    bitrateKbps: rawCapacity.bitrateKbps ?? null };
  if ([capacity.monthlyBudgetUsd, capacity.estimatedMonthlyUsd].some(item => item !== null && !money(item)) ||
    capacity.bitrateKbps !== null && (!Number.isInteger(capacity.bitrateKbps) || capacity.bitrateKbps < 8 || capacity.bitrateKbps > 320)) invalid();
  const blockers = value.blockers.map(item => /^RETAIL_PLAYOUT_[A-Z_]{1,80}$/.test(item || "") ? item : "RETAIL_PLAYOUT_REVIEW_REQUIRED");
  if (value.canStart && (!value.connectionSaved || !station || !prepared || value.enabled || blockers.length ||
    value.eligibleTrackCount < 2 || !capacity.assigned || !money(capacity.monthlyBudgetUsd) ||
    !money(capacity.estimatedMonthlyUsd) || capacity.estimatedMonthlyUsd > capacity.monthlyBudgetUsd)) invalid();
  let observation = null;
  if (value.observation != null) {
    const raw = value.observation;
    if (!["STARTING", "STREAMING", "DISCONNECTED", "ERROR", "STOPPED", "UNKNOWN"].includes(raw.state) ||
      typeof raw.fresh !== "boolean" || !["RANDOM", "SCHEDULED", "COMMERCIAL", "UNKNOWN", null, undefined].includes(raw.phase)) invalid();
    const observedAt = timestamp(raw.observedAt);
    if (raw.fresh && !observedAt) invalid();
    let track = null;
    if (raw.track != null) {
      if (!id(raw.track.id) || !bounded(raw.track.title, 240) || !bounded(raw.track.artist, 240)) invalid();
      track = { id: raw.track.id, title: raw.track.title, artist: raw.track.artist };
    }
    observation = { state: raw.state, fresh: raw.fresh, observedAt, phase: raw.phase || "UNKNOWN", track };
  }
  return { organisation: { id: organisationId, name: value.organisation.name }, station,
    connectionSaved: value.connectionSaved, prepared: prepared ? { ...prepared, genreCodes: [...prepared.genreCodes] } : null,
    availableGenres: genres, eligibleTrackCount: value.eligibleTrackCount, canPrepare: value.canPrepare,
    canStart: value.canStart, enabled: value.enabled, blockers, capacity, observation };
}

const notices = {
  ADMIN_REQUIRED: "Sign in as the platform owner to manage this Retail stream.",
  OWNER_REQUIRED: "Sign in as the platform owner to manage this Retail stream.",
  ORGANISATION_NOT_FOUND: "The Retail subscriber workspace could not be found.",
  STATION_REQUIRED: "Save this subscriber’s Centova connection first.",
  CONNECTION_REQUIRED: "Save this subscriber’s Centova connection first.",
  SOURCE_NOT_READY: "The saved Centova connection needs review before streaming can start.",
  SOURCE_INVALID: "The saved Centova destination needs administrator review before streaming can start.",
  SOURCE_DNS_UNAVAILABLE: "The saved Centova hostname could not be verified. Confirm the correct provider address before starting audio.",
  PROGRAMME_REQUIRED: "Save a music selection for this shared stream.",
  PREPARATION_REQUIRED: "Save a music selection for this shared stream.",
  NO_APPROVED_MUSIC: "There are not yet enough eligible recordings for this Retail programme. Catalogue access and playback approval are checked separately.",
  SERVICE_INACTIVE: "This subscriber’s Retail service is not active.",
  OUTPUT_NOT_PERMITTED: "This account’s current plan does not permit audio output. A saved test connection does not change its plan.",
  CAPACITY_REQUIRED: "No approved hosting capacity is assigned. No new paid service has been created.",
  CAPACITY_NOT_ASSIGNED: "No approved hosting capacity is assigned. No new paid service has been created.",
  CAPACITY_UNAVAILABLE: "No approved hosting capacity is available for this Retail stream.",
  CAPACITY_INVALID: "The hosting assignment needs administrator review.",
  START_DISABLED: "Live Retail activation is not enabled on this host. Preparation does not start audio.",
  LIVE_DISABLED: "Live Retail activation is not enabled on this host. Preparation does not start audio.",
  APPROVAL_REQUIRED: "Review the approved monthly allowance and listener access before starting.",
  BUDGET_APPROVAL_REQUIRED: "The monthly allowance changed. Refresh and review the current approved amount before starting.",
  PUBLIC_EXPOSURE_REQUIRED: "Confirm who may listen through the Centova address before starting.",
  BUDGET_EXCEEDED: "The estimated running cost exceeds the approved monthly allowance.",
  BUDGET_EXHAUSTED: "The approved streaming allowance has been reached.",
  SOURCE_CHANGED: "The saved destination changed after approval. Review it before starting again.",
  SOURCE_CONFLICT: "This destination is already assigned to another stream.",
  SOURCE_ALREADY_ASSIGNED: "This destination is already assigned to another stream.",
  MULTIPLE_STREAMS: "This subscriber already has another Retail stream. Review it before assigning a shared programme.",
  CAPACITY_CONFLICT: "The hosting assignment overlaps another stream and needs administrator review.",
  BITRATE_NOT_SUPPORTED: "This audio engine currently supports 128 kbps. The saved bitrate and plan limits have not been changed.",
  BITRATE_NOT_ALLOWED: "The saved bitrate exceeds the approved capacity or current plan limit.",
  GENRE_UNAVAILABLE: "A saved music genre is no longer available. Review the programme selection.",
  STOP_BEFORE_PREPARING: "Stop this Retail stream and confirm its source has disconnected before changing its music selection.",
  WORKER_BUSY: "Another encoder still holds this stream. Its connection must be released before starting a replacement.",
  STOP_UNCONFIRMED: "The worker has not confirmed that its connection stopped. Refresh status; do not start another encoder.",
  TERRITORY_REQUIRED: "Choose the country in which the shops will use this programme.",
  INPUT_INVALID: "Check the music selection and try again.",
  RELOAD_REQUIRED: "Refresh the saved status before sending another change.",
  REVIEW_REQUIRED: "This Retail stream needs administrator review before it can start. No settings or plan limits were changed."
};
export function retailPlayoutNotice(value) {
  const key = typeof value === "string" ? value.replace(/^RETAIL_PLAYOUT_/, "") : "";
  return Object.hasOwn(notices, key) ? notices[key] : notices.REVIEW_REQUIRED;
}

export function retailMusicRequest({ territory, genreCodes }) {
  const country = typeof territory === "string" ? territory.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country) || !Array.isArray(genreCodes) || genreCodes.length > 100 || genreCodes.some(item => !code(item)) ||
    new Set(genreCodes).size !== genreCodes.length) throw new Error("Choose a two-letter shop country and up to 100 music genres.");
  return { action: "prepare", territory: country, genreCodes: [...genreCodes] };
}

export function retailStartRequest(view, accepted) {
  const safe = safeRetailPlayoutView(view, view?.organisation?.id);
  if (!safe.canStart || accepted !== true) throw new Error("Review the ready status, approved cost and listener access before starting.");
  return { action: "start", monthlyBudgetUsd: safe.capacity.monthlyBudgetUsd, publicExposureAccepted: true };
}

export function retailSourceSummary(view, now = new Date()) {
  const report = view.observation;
  const elapsed = report?.observedAt ? now.getTime() - Date.parse(report.observedAt) : Infinity;
  const fresh = report?.fresh === true && elapsed >= 0 && elapsed <= 15000;
  if (fresh && report.state === "STREAMING") return { label: "Source sending audio", detail: report.track ? `${report.track.artist} — ${report.track.title}` : "A fresh encoder report confirms audio being sent.", fresh: true };
  if (view.enabled) return { label: "Start requested · waiting for fresh audio evidence", detail: "An enabled programme alone does not confirm that listeners can hear it.", fresh: false };
  return { label: "Retail audio not enabled", detail: report ? "The last source report is shown below. No current listener test has been performed here." : "No current audio source report is available.", fresh: false };
}
