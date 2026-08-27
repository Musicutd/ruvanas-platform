const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REPORT_DAYS = 93;

function dateOnly(value, label) {
  const text = String(value || "").trim();
  if (!DATE_PATTERN.test(text)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
  return { text, date };
}

function optionalIdentifier(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > 64 || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("A report filter is invalid.");
  return text;
}

export function defaultCampaignProofDates(now = new Date()) {
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(`${to}T00:00:00.000Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export function normaliseCampaignProofFilters(input = {}, now = new Date()) {
  const defaults = defaultCampaignProofDates(now);
  const from = dateOnly(input.from || defaults.from, "From date");
  const to = dateOnly(input.to || defaults.to, "To date");
  const days = Math.round((to.date - from.date) / 86_400_000) + 1;
  if (days < 1) throw new Error("The from date must not be after the to date.");
  if (days > MAX_REPORT_DAYS) throw new Error(`Reports are limited to ${MAX_REPORT_DAYS} days.`);
  return {
    from: from.text,
    to: to.text,
    campaignId: optionalIdentifier(input.campaignId),
    promoVersionId: optionalIdentifier(input.promoVersionId),
    locationId: optionalIdentifier(input.locationId),
    locationGroupId: optionalIdentifier(input.locationGroupId)
  };
}

export function reportUtcQueryWindow(filters) {
  const from = new Date(`${filters.from}T00:00:00.000Z`);
  from.setUTCHours(from.getUTCHours() - 14);
  const until = new Date(`${filters.to}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  until.setUTCHours(until.getUTCHours() + 14);
  return { from, until };
}

export function localReportBucket(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function locationGroups(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((group) => group && typeof group.id === "string")
    .map((group) => ({ id: group.id, name: String(group.name || group.id) }));
}

export function aggregateCampaignProof({ intents = [], events = [], filters }) {
  const normalised = normaliseCampaignProofFilters(filters);
  const statesByIntent = new Map();
  const statesByScheduleItem = new Map();
  for (const event of events) {
    const map = event.playoutIntentId ? statesByIntent : statesByScheduleItem;
    const key = event.playoutIntentId || event.scheduleItemId;
    if (!key) continue;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(event.eventType);
  }
  const selected = [];
  for (const intent of intents) {
    const bucket = localReportBucket(intent.plannedStart, intent.locationTimezone);
    const groups = locationGroups(intent.locationGroups);
    if (bucket.date < normalised.from || bucket.date > normalised.to) continue;
    if (normalised.campaignId && intent.campaignId !== normalised.campaignId) continue;
    if (normalised.promoVersionId && intent.promoVersionId !== normalised.promoVersionId) continue;
    if (normalised.locationId && intent.locationId !== normalised.locationId) continue;
    if (normalised.locationGroupId && !groups.some((group) => group.id === normalised.locationGroupId)) continue;
    selected.push({
      intent,
      bucket,
      groups,
      states: statesByIntent.get(intent.id) || statesByScheduleItem.get(intent.scheduleItemId) || new Set()
    });
  }

  const summary = { planned: selected.length, started: 0, completed: 0, failed: 0 };
  const rows = new Map();
  for (const item of selected) {
    if (item.states.has("STARTED")) summary.started += 1;
    if (item.states.has("COMPLETED")) summary.completed += 1;
    if (item.states.has("FAILED")) summary.failed += 1;
    const groups = normalised.locationGroupId
      ? item.groups.filter((group) => group.id === normalised.locationGroupId)
      : (item.groups.length ? item.groups : [{ id: null, name: "Ungrouped" }]);
    for (const group of groups) {
      const intent = item.intent;
      const key = [intent.campaignId, intent.promoVersionId, intent.locationId, group.id || "", item.bucket.date, item.bucket.hour].join("|");
      const current = rows.get(key) || {
        campaignId: intent.campaignId,
        campaignName: intent.campaign?.name || intent.campaignName || "Campaign",
        promoVersionId: intent.promoVersionId,
        promoName: intent.promoVersion?.promoAsset?.name || intent.promoName || "Promotion",
        promoVersion: intent.promoVersion?.version ?? intent.promoVersionNumber ?? null,
        locationId: intent.locationId,
        locationName: intent.locationName,
        locationGroupId: group.id,
        locationGroupName: group.name,
        localDate: item.bucket.date,
        localHour: item.bucket.hour,
        timezone: intent.locationTimezone,
        planned: 0,
        started: 0,
        completed: 0,
        failed: 0
      };
      current.planned += 1;
      if (item.states.has("STARTED")) current.started += 1;
      if (item.states.has("COMPLETED")) current.completed += 1;
      if (item.states.has("FAILED")) current.failed += 1;
      rows.set(key, current);
    }
  }

  const orderedRows = [...rows.values()].sort((left, right) =>
    right.localDate.localeCompare(left.localDate) ||
    right.localHour - left.localHour ||
    left.campaignName.localeCompare(right.campaignName) ||
    left.locationName.localeCompare(right.locationName) ||
    left.locationGroupName.localeCompare(right.locationGroupName)
  );
  return {
    filters: normalised,
    summary: {
      ...summary,
      awaitingConfirmation: Math.max(0, summary.planned - summary.completed - summary.failed),
      completionRate: summary.started ? Math.min(1, summary.completed / summary.started) : 0,
      metricBasis: "device-confirmed playback",
      audienceMeasurement: false
    },
    rows: orderedRows
  };
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function campaignProofCsv(report) {
  const header = [
    "Metric basis", "Audience measured", "Local date", "Local hour", "Timezone",
    "Campaign", "Promo", "Promo version", "Location", "Location group",
    "Planned", "Started", "Confirmed complete", "Failed", "Completion rate"
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of report.rows) {
    lines.push([
      "device-confirmed playback",
      "No",
      row.localDate,
      `${String(row.localHour).padStart(2, "0")}:00-${String(row.localHour).padStart(2, "0")}:59`,
      row.timezone,
      row.campaignName,
      row.promoName,
      row.promoVersion,
      row.locationName,
      row.locationGroupName,
      row.planned,
      row.started,
      row.completed,
      row.failed,
      row.started ? (row.completed / row.started).toFixed(4) : "0.0000"
    ].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

