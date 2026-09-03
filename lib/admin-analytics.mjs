export const ADMIN_ANALYTICS_RANGES = Object.freeze([7, 14, 30, 90]);

export function normaliseAdminAnalyticsRange(value, fallback = 14) {
  const parsed = Number(value);
  return ADMIN_ANALYTICS_RANGES.includes(parsed) ? parsed : fallback;
}

export function utcDayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function adminAnalyticsPeriod(value, now = new Date()) {
  const days = normaliseAdminAnalyticsRange(value);
  const currentStart = new Date(now);
  currentStart.setUTCHours(0, 0, 0, 0);
  currentStart.setUTCDate(currentStart.getUTCDate() - (days - 1));
  const previousStart = new Date(currentStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  return { days, currentStart, previousStart, previousEnd: currentStart, until: new Date(now) };
}

export function buildAdminDailySeries({ aggregateRows = [], leaseRows = [], startDate, days }) {
  const totals = new Map();
  for (const row of aggregateRows) {
    const key = utcDayKey(row.bucketStart);
    const current = totals.get(key) || { completed: 0, failed: 0, heartbeats: 0, sessionStarts: 0 };
    current.completed += row._sum?.playbackCompletedCount || 0;
    current.failed += (row._sum?.playbackFailedCount || 0) + (row._sum?.playbackInterruptedCount || 0);
    current.heartbeats += row._sum?.heartbeatCount || 0;
    totals.set(key, current);
  }
  for (const lease of leaseRows) {
    const key = utcDayKey(lease.createdAt);
    const current = totals.get(key) || { completed: 0, failed: 0, heartbeats: 0, sessionStarts: 0 };
    current.sessionStarts += 1;
    totals.set(key, current);
  }

  return Array.from({ length: days }, (_, index) => {
    const day = new Date(startDate);
    day.setUTCDate(day.getUTCDate() + index);
    const key = utcDayKey(day);
    return { key, ...(totals.get(key) || { completed: 0, failed: 0, heartbeats: 0, sessionStarts: 0 }) };
  });
}

export function sumAdminAnalyticsSeries(series = []) {
  return series.reduce((totals, item) => ({
    completed: totals.completed + item.completed,
    failed: totals.failed + item.failed,
    heartbeats: totals.heartbeats + item.heartbeats,
    sessionStarts: totals.sessionStarts + item.sessionStarts
  }), { completed: 0, failed: 0, heartbeats: 0, sessionStarts: 0 });
}

export function analyticsChange(current, previous) {
  if (previous === 0) return current === 0 ? { percentage: 0, direction: "steady" } : { percentage: null, direction: "new" };
  const percentage = Math.round(((current - previous) / previous) * 100);
  return { percentage, direction: percentage > 0 ? "up" : percentage < 0 ? "down" : "steady" };
}

export function classifyServiceFamily(subscription) {
  const plan = subscription?.plan || {};
  const identity = `${plan.code || ""} ${plan.name || ""}`.toLowerCase();
  if (identity.includes("school") || subscription?.schoolRadioEnabled === true || plan.schoolRadioEnabled === true) return "School Radio";
  if (identity.includes("online") || identity.includes("broadcast")) return "Complete Online Radio";
  return "Retail / In-house Radio";
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function adminManagementCsv(snapshot) {
  const rows = [["Section", "Metric", "Value", "Context"]];
  const add = (section, metric, value, context = "") => rows.push([section, metric, value, context]);
  add("Reporting period", "From", snapshot.filters.from, `${snapshot.filters.days} days`);
  add("Reporting period", "To", snapshot.filters.to, "UTC");
  add("Platform", "Customer organisations", snapshot.totals.organisations);
  add("Platform", "Active subscriptions", snapshot.totals.activeSubscriptions);
  add("Platform", "Active stations", snapshot.totals.activeStations);
  add("Platform", "Configured players", snapshot.totals.configuredPlayers);
  add("Platform", "Online players", snapshot.totals.onlinePlayers);
  add("Delivery", "Completed playback", snapshot.periodTotals.completed);
  add("Delivery", "Failed or interrupted playback", snapshot.periodTotals.failed);
  add("Delivery", "Stream sessions started", snapshot.periodTotals.sessionStarts);
  add("Delivery", "Player heartbeats", snapshot.periodTotals.heartbeats);
  add("Attention", "Offline players", snapshot.attention.offlinePlayers);
  add("Attention", "Open support tickets", snapshot.attention.openSupportTickets);
  add("Attention", "Player health incidents", snapshot.attention.playerIncidents);
  add("Attention", "Stream health incidents", snapshot.attention.streamIncidents);
  add("Attention", "Dead-letter jobs", snapshot.attention.deadLetterJobs);
  for (const item of snapshot.serviceMix) add("Service mix", item.label, item.value);
  for (const item of snapshot.topOrganisations) add("Organisation delivery", item.name, item.completed, `${item.failed} failed or interrupted`);
  for (const item of snapshot.topStations) add("Station delivery", item.name, item.completed, item.organisationName);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
