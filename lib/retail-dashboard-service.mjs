import { evaluateLocationOpen, formatLocalTime, localDateTimeParts } from "./opening-hours.mjs";
import { resolveMusicSchedule } from "./music-scheduling.mjs";
import { subscriberPlayerReadiness } from "./subscriber-player-readiness.mjs";

const MAX_LOCATIONS = 200;
const MAX_PLAYERS = 600;
const MAX_SCHEDULES = 200;
const MAX_CAMPAIGNS = 200;
const EVIDENCE_WINDOW_MS = 15 * 60 * 1000;

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
}

function currentWindow(location, now) {
  const weeklyHours = location.openingHours || [];
  const exceptions = location.openingExceptions || [];
  const local = localDateTimeParts(now, location.timezone);
  const yesterday = new Date(`${local.date}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (!weeklyHours.length && !exceptions.some((entry) => [local.date, yesterday.toISOString().slice(0, 10)].includes(dateKey(entry.date)))) {
    return { state: "UNKNOWN", local };
  }
  const result = evaluateLocationOpen({ instant: now, timezone: location.timezone, weeklyHours, exceptions });
  return { state: result.isOpen ? "OPEN" : "CLOSED", local: result.local };
}

function activeAssignment(zone) {
  return zone.channelAssignments?.[0]?.channel || null;
}

function relevantSchedules(schedules, locationId, zoneId) {
  return schedules.filter((schedule) => schedule.locationId === locationId || schedule.zoneId === zoneId);
}

function latestPublishedSchedules(schedules) {
  const result = new Map();
  for (const schedule of schedules) {
    const key = schedule.zoneId ? `zone:${schedule.zoneId}` : `location:${schedule.locationId}`;
    const previous = result.get(key);
    if (!previous || schedule.version > previous.version) result.set(key, schedule);
  }
  return [...result.values()];
}

function campaignApplies(campaign, location) {
  return (campaign.targets || []).some((target) => target.targetType === "ALL_LOCATIONS" ||
    (target.targetType === "LOCATION" && target.locationId === location.id) ||
    (target.targetType === "ZONE" && location.zones.some((zone) => zone.id === target.zoneId)) ||
    (target.targetType === "BRAND" && target.brandId === location.brandId) ||
    (target.targetType === "LOCATION_GROUP" && location.groupMemberships?.some((member) => member.locationGroupId === target.locationGroupId)));
}

function campaignActiveOn(campaign, date) {
  return dateKey(campaign.effectiveFrom) <= date && dateKey(campaign.effectiveTo) >= date;
}

function playerState(player, zone, now) {
  const assignments = zone.channelAssignments?.filter((assignment) => assignment.channel?.status === "ACTIVE") || [];
  return subscriberPlayerReadiness({ ...player, zone: { channelAssignments: assignments } }, now);
}

function zoneSummary(zone, location, schedules, players, now, windowState) {
  const assignedChannel = activeAssignment(zone);
  const channel = assignedChannel?.status === "ACTIVE" ? assignedChannel : null;
  const policy = channel?.autoDjPolicy?.rightsUse === "RETAIL_RADIO" && channel.autoDjPolicy.state === "ACTIVE" ? channel.autoDjPolicy : null;
  const current = resolveMusicSchedule({
    schedules: relevantSchedules(schedules, location.id, zone.id),
    instant: now,
    timezone: location.timezone,
    locationOpen: windowState !== "CLOSED",
    autoDjPolicy: policy || { enabled: false, playbackPolicy: "FOLLOW_LOCATION_HOURS" },
    musicModeAvailable: (mode) => mode?.status === "ACTIVE"
  });
  const zonePlayers = players.filter((player) => player.zoneId === zone.id);
  const readiness = zonePlayers.map((player) => ({ name: player.name, ...playerState(player, zone, now) }));
  const verified = readiness.find((item) => item.ready);
  const lastPlayback = readiness.filter((item) => item.lastPlaybackAt).sort((a, b) => b.lastPlaybackAt.localeCompare(a.lastPlaybackAt))[0] || null;
  const hasRecentProof = Boolean(lastPlayback && ["STARTED", "COMPLETED"].includes(lastPlayback.latestPlayback?.eventType) && now.getTime() - new Date(lastPlayback.lastPlaybackAt).getTime() <= EVIDENCE_WINDOW_MS);
  let state = "HEALTHY";
  if (zone.status === "OFFLINE") state = "OFFLINE";
  else if (zone.status !== "ACTIVE" || !channel || !zonePlayers.length || readiness.every((item) => item.level === "WAITING")) state = "SETUP";
  else if (windowState === "CLOSED") state = "CLOSED";
  else if (readiness.every((item) => item.code === "OFFLINE")) state = "OFFLINE";
  else if (readiness.some((item) => !item.ready)) state = "ATTENTION";
  return {
    id: zone.id,
    name: zone.name,
    state,
    playerCount: zonePlayers.length,
    readyPlayerCount: readiness.filter((item) => item.ready).length,
    selectedSound: current.musicMode?.name || null,
    sourceLabel: current.musicMode ? current.sourceLabel : null,
    autoDjEnabled: Boolean(policy?.enabled),
    recentPlayback: hasRecentProof ? { title: lastPlayback.latestPlayback.trackTitle, artist: lastPlayback.latestPlayback.trackArtist, at: lastPlayback.lastPlaybackAt } : null,
    playerSummary: verified ? "Playback confirmed" : readiness[0]?.summary || "No player configured",
    lastContactAt: readiness.filter((item) => item.lastHeartbeatAt).sort((a, b) => b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt))[0]?.lastHeartbeatAt || null
  };
}

function storeState(zones, locationStatus, windowState) {
  if (locationStatus !== "ACTIVE" || !zones.length) return "SETUP";
  if (windowState === "CLOSED") return "CLOSED";
  if (zones.every((zone) => zone.state === "OFFLINE")) return "OFFLINE";
  if (zones.some((zone) => ["OFFLINE", "ATTENTION"].includes(zone.state))) return "ATTENTION";
  if (zones.some((zone) => zone.state === "SETUP")) return "SETUP";
  return "HEALTHY";
}

function todayTimeline(stores, schedules, now) {
  const events = [];
  for (const store of stores) {
    const local = localDateTimeParts(now, store.timezone);
    for (const schedule of schedules) {
      if (schedule.locationId !== store.id && !store.zones.some((zone) => zone.id === schedule.zoneId)) continue;
      for (const slot of schedule.slots || []) {
        if (slot.musicMode?.status !== "ACTIVE") continue;
        const daysAhead = (slot.weekday - local.weekday + 7) % 7;
        const minutesAhead = daysAhead * 1440 + slot.startMinute - local.minute;
        if (daysAhead !== 0 || minutesAhead <= 0) continue;
        const date = new Date(`${local.date}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() + daysAhead);
        if (!campaignActiveOn({ effectiveFrom: schedule.effectiveFrom || "0000-01-01", effectiveTo: schedule.effectiveTo || "9999-12-31" }, date.toISOString().slice(0, 10))) continue;
        events.push({ id: `${schedule.id}:${slot.id}:${store.id}`, minutesAhead, time: formatLocalTime(slot.startMinute), timezone: store.timezone, storeName: store.name, label: `${slot.musicMode.name} scheduled`, type: "MUSIC" });
      }
    }
  }
  return events.sort((a, b) => a.minutesAhead - b.minutesAhead || a.storeName.localeCompare(b.storeName)).slice(0, 6);
}

export function deriveRetailControlCentre({ locations = [], players = [], schedules = [], campaigns = [], signageDevices = [], activeMusicModeCount = 0, now = new Date(), entitlements = {}, role = "VIEWER" } = {}) {
  const latestSchedules = latestPublishedSchedules(schedules);
  const canManage = ["OWNER", "MANAGER"].includes(role);
  const stores = locations.map((location) => {
    const hours = currentWindow(location, now);
    const zones = (location.zones || []).map((zone) => zoneSummary(zone, location, latestSchedules, players, now, hours.state));
    const state = storeState(zones, location.status, hours.state);
    const todaysCampaigns = campaigns.filter((campaign) => campaignActiveOn(campaign, hours.local.date) && campaignApplies(campaign, location));
    const storeScreens = entitlements.digitalSignageEnabled ? signageDevices.filter((device) => zones.some((zone) => zone.id === device.zoneId)) : [];
    return {
      id: location.id, name: location.name, city: location.city || null, timezone: location.timezone,
      state, openingState: hours.state, zones, activeZoneCount: zones.length,
      readyPlayerCount: zones.reduce((total, zone) => total + zone.readyPlayerCount, 0),
      playerCount: zones.reduce((total, zone) => total + zone.playerCount, 0),
      promotionCount: todaysCampaigns.length,
      promotionIds: todaysCampaigns.map((campaign) => campaign.id),
      screenCount: storeScreens.length,
      onlineScreenCount: storeScreens.filter((screen) => screen.status === "ONLINE" && screen.lastHeartbeatAt && now.getTime() - new Date(screen.lastHeartbeatAt).getTime() <= 90_000).length
    };
  });
  const activeStores = locations.filter((location) => location.status === "ACTIVE");
  const attentionStores = stores.filter((store) => ["ATTENTION", "OFFLINE", "SETUP"].includes(store.state));
  const recentlyConfirmed = stores.flatMap((store) => store.zones.flatMap((zone) => zone.recentPlayback ? [{ ...zone.recentPlayback, storeName: store.name, zoneName: zone.name }] : [])).sort((a, b) => b.at.localeCompare(a.at));
  const configuredSounds = [...new Set(stores.flatMap((store) => store.zones.map((zone) => zone.selectedSound).filter(Boolean)))];
  const promotionIds = new Set(stores.flatMap((store) => store.promotionIds));
  const timeline = todayTimeline(stores, latestSchedules, now);
  return {
    checkedAt: now.toISOString(), canManage,
    limited: locations.length >= MAX_LOCATIONS || players.length >= MAX_PLAYERS || schedules.length >= MAX_SCHEDULES || campaigns.length >= MAX_CAMPAIGNS || signageDevices.length >= MAX_PLAYERS,
    counts: { stores: stores.length, activeStores: activeStores.length, healthyStores: stores.filter((store) => store.state === "HEALTHY").length, attentionStores: attentionStores.length, zones: stores.reduce((total, store) => total + store.activeZoneCount, 0), players: stores.reduce((total, store) => total + store.playerCount, 0), readyPlayers: stores.reduce((total, store) => total + store.readyPlayerCount, 0), activeAutoDjPolicies: stores.reduce((total, store) => total + store.zones.filter((zone) => zone.autoDjEnabled).length, 0), publishedSchedules: latestSchedules.length, activeMusicModes: activeMusicModeCount, promotionsToday: promotionIds.size, screens: entitlements.digitalSignageEnabled ? signageDevices.length : 0 },
    overallState: !stores.length || stores.every((store) => store.state === "SETUP") ? "SETUP" : stores.every((store) => store.state === "CLOSED") ? "CLOSED" : attentionStores.length ? "ATTENTION" : "HEALTHY",
    recentPlayback: recentlyConfirmed[0] || null,
    configuredSound: configuredSounds.length === 1 ? configuredSounds[0] : configuredSounds.length > 1 ? "Different sounds across stores" : null,
    timeline,
    attention: attentionStores.slice(0, 5).map((store) => ({ id: store.id, name: store.name, state: store.state, message: store.state === "OFFLINE" ? "No player in this store is currently connected." : store.state === "SETUP" ? "Store setup or player connection is incomplete." : "A player needs a connection or playback check.", href: store.state === "SETUP" && !store.zones.length ? "/dashboard/locations" : "/dashboard/players" })),
    stores,
    entitlements: { digitalSignageEnabled: Boolean(entitlements.digitalSignageEnabled), retailMediaEnabled: Boolean(entitlements.retailMediaEnabled), serviceEnabled: Boolean(entitlements.serviceEnabled) }
  };
}

export async function loadRetailControlCentre(database, { organisationId, role, entitlements, now = new Date() }) {
  const previousDay = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const nextDay = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const [locations, players, schedules, campaigns, activeMusicModeCount, signageDevices] = await Promise.all([
    database.location.findMany({ where: { organisationId, status: { not: "CLOSED" } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: MAX_LOCATIONS, select: { id: true, name: true, city: true, brandId: true, status: true, timezone: true, openingHours: { select: { weekday: true, isClosed: true, opensAtMinute: true, closesAtMinute: true } }, openingExceptions: { where: { date: { gte: previousDay, lte: nextDay } }, select: { date: true, isClosed: true, opensAtMinute: true, closesAtMinute: true } }, groupMemberships: { select: { locationGroupId: true } }, zones: { orderBy: { name: "asc" }, select: { id: true, name: true, status: true, channelAssignments: { where: { activeFrom: { lte: now }, OR: [{ activeTo: null }, { activeTo: { gt: now } }] }, orderBy: { activeFrom: "desc" }, take: 1, select: { channel: { select: { id: true, name: true, status: true, autoDjPolicy: { select: { enabled: true, state: true, rightsUse: true, playbackPolicy: true, defaultMusicMode: { select: { id: true, name: true, status: true } }, backupMusicMode: { select: { id: true, name: true, status: true } } } } } } } } } } } }),
    database.player.findMany({ where: { organisationId, status: { not: "DISABLED" } }, orderBy: { createdAt: "desc" }, take: MAX_PLAYERS, select: { id: true, name: true, zoneId: true, status: true, enrolledAt: true, lastHeartbeatAt: true, heartbeatSamples: { orderBy: { observedAt: "desc" }, take: 1, select: { observedAt: true, appVersion: true, manifestVersion: true, sourceStatus: true } }, proofOfPlayEvents: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true, eventType: true, trackTitle: true, trackArtist: true, manifestVersion: true } } } }),
    database.musicSchedule.findMany({ where: { organisationId, status: "PUBLISHED" }, orderBy: [{ version: "desc" }, { updatedAt: "desc" }], take: MAX_SCHEDULES, select: { id: true, locationId: true, zoneId: true, status: true, version: true, effectiveFrom: true, effectiveTo: true, slots: { select: { id: true, weekday: true, startMinute: true, endMinute: true, priority: true, musicMode: { select: { id: true, name: true, status: true } } } } } }),
    database.campaign.findMany({ where: { organisationId, status: "PUBLISHED" }, orderBy: { updatedAt: "desc" }, take: MAX_CAMPAIGNS, select: { id: true, name: true, effectiveFrom: true, effectiveTo: true, targets: { select: { targetType: true, brandId: true, locationGroupId: true, locationId: true, zoneId: true } } } }),
    database.musicMode.count({ where: { organisationId, status: "ACTIVE" } }),
    entitlements.digitalSignageEnabled ? database.digitalSignageDevice.findMany({ where: { organisationId, status: { not: "DISABLED" } }, take: MAX_PLAYERS, select: { id: true, zoneId: true, status: true, lastHeartbeatAt: true } }) : Promise.resolve([])
  ]);
  return deriveRetailControlCentre({ locations, players, schedules, campaigns, activeMusicModeCount, signageDevices, now, entitlements, role });
}
