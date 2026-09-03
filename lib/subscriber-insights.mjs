export const SUBSCRIBER_INSIGHT_RANGES = Object.freeze([7, 14, 30, 90]);

export function normaliseSubscriberInsightRange(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return SUBSCRIBER_INSIGHT_RANGES.includes(parsed) ? parsed : 30;
}

export function subscriberInsightDates(days, now = new Date()) {
  const safeDays = normaliseSubscriberInsightRange(days);
  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (safeDays - 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days: safeDays
  };
}

function total(row, field) {
  return Number(row?._sum?.[field] || row?.[field] || 0);
}

function addBreakdown(map, key, name, row, extra = {}) {
  if (!key) return;
  const current = map.get(key) || {
    id: key,
    name: name || "Unnamed",
    completed: 0,
    failed: 0,
    interrupted: 0,
    started: 0,
    heartbeat: 0,
    ...extra
  };
  current.completed += total(row, "playbackCompletedCount");
  current.failed += total(row, "playbackFailedCount");
  current.interrupted += total(row, "playbackInterruptedCount");
  current.started += total(row, "playbackStartedCount");
  current.heartbeat += total(row, "heartbeatCount");
  map.set(key, current);
}

function ranked(map) {
  return [...map.values()]
    .map((item) => ({
      ...item,
      exceptions: item.failed + item.interrupted,
      confirmationRate: item.started ? Math.min(1, item.completed / item.started) : 0
    }))
    .sort((left, right) => right.completed - left.completed || left.name.localeCompare(right.name));
}

export function buildSubscriberBreakdowns(rows = []) {
  const locations = new Map();
  const players = new Map();
  for (const row of rows) {
    addBreakdown(locations, row.locationId, row.locationName, row);
    addBreakdown(players, row.playerId, row.playerName, row, {
      locationName: row.locationName || "Location",
      zoneName: row.zoneName || "Zone"
    });
  }
  return { locations: ranked(locations), players: ranked(players) };
}

export function buildStationBreakdown(rows = [], channels = []) {
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
  const stations = new Map();
  for (const row of rows) {
    const channel = channelMap.get(row.channelId);
    if (!channel?.station) continue;
    const current = stations.get(channel.station.id) || {
      id: channel.station.id,
      name: channel.station.name,
      completed: 0,
      status: channel.station.status
    };
    current.completed += Number(row._count?._all || 0);
    stations.set(current.id, current);
  }
  return [...stations.values()].sort((left, right) => right.completed - left.completed || left.name.localeCompare(right.name));
}

export function subscriberInsightActions(report) {
  if (!report) return [];
  const actions = [];
  if (report.players.offlineNow > 0) actions.push({
    code: "OFFLINE_PLAYERS",
    count: report.players.offlineNow,
    title: "Players need attention",
    description: "One or more enrolled players are not currently reporting.",
    href: "/dashboard/players",
    label: "Review players",
    tone: "critical"
  });
  const exceptions = report.summary.playbackFailedCount + report.summary.playbackInterruptedCount;
  if (exceptions > 0) actions.push({
    code: "PLAYBACK_EXCEPTIONS",
    count: exceptions,
    title: "Playback exceptions recorded",
    description: "Review failures or interrupted items before changing a schedule.",
    href: "/dashboard/support",
    label: "Get support",
    tone: "warning"
  });
  if (report.summary.playbackStartedCount > 0 && report.summary.confirmationRate < 0.95) actions.push({
    code: "CONFIRMATION_RATE",
    count: Math.round(report.summary.confirmationRate * 100),
    suffix: "%",
    title: "Completion rate below 95%",
    description: "Use the daily evidence table to identify when confirmations dropped.",
    href: "#daily-evidence",
    label: "Review evidence",
    tone: "neutral"
  });
  return actions;
}
