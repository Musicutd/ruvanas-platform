import crypto from "node:crypto";

function day(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function unique(values = []) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]
    .sort((left, right) => typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right)));
}

function scheduleSegments(schedule) {
  if (schedule.windowMode === "EXACT_TIME") {
    return [{ weekday: schedule.weekday, start: schedule.exactMinute, end: schedule.exactMinute + 1 }];
  }
  if (schedule.endMinute > schedule.startMinute) {
    return [{ weekday: schedule.weekday, start: schedule.startMinute, end: schedule.endMinute }];
  }
  return [
    { weekday: schedule.weekday, start: schedule.startMinute, end: 1440 },
    { weekday: (schedule.weekday + 1) % 7, start: 0, end: schedule.endMinute }
  ];
}

function visualSegments(playlist) {
  return (playlist.activeDays || []).flatMap((weekday) => scheduleSegments({
    weekday,
    windowMode: "WINDOW",
    startMinute: playlist.dailyStartMinute,
    endMinute: playlist.dailyEndMinute
  }));
}

function intervalsForWeekday(dayparts, weekday) {
  const ordered = (dayparts || [])
    .filter((part) => part.weekday === weekday)
    .map((part) => ({ start: part.startMinute, end: part.endMinute }))
    .sort((left, right) => left.start - right.start);
  const merged = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function uncoveredSegments(segments, dayparts) {
  return segments.filter((segment) => !intervalsForWeekday(dayparts, segment.weekday)
    .some((interval) => interval.start <= segment.start && interval.end >= segment.end));
}

function outsideInventory(targetZoneIds, inventoryZoneIds) {
  const eligible = new Set(inventoryZoneIds || []);
  return unique(targetZoneIds).filter((zoneId) => !eligible.has(zoneId));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function bySchedule(left, right) {
  return left.weekday - right.weekday ||
    (left.startMinute ?? left.exactMinute ?? 0) - (right.startMinute ?? right.exactMinute ?? 0) ||
    (left.endMinute ?? 0) - (right.endMinute ?? 0);
}

export function crossMediaConfigurationHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function crossMediaReadiness(input = {}) {
  const inventory = input.inventory || {};
  const audio = input.audio || {};
  const visual = input.visual || {};
  const audioBlockers = [];
  const visualBlockers = [];
  const sharedBlockers = [];
  const inventoryFrom = day(inventory.effectiveFrom);
  const inventoryTo = day(inventory.effectiveTo);
  const inventoryZoneIds = unique(inventory.targetZoneIds);
  const approvedAssetIds = unique(visual.approvedAssetIds);

  if (!new Set(["APPROVED", "FULFILLED"]).has(input.orderStatus)) sharedBlockers.push("The order must be approved before delivery can be activated.");
  if (inventory.status !== "ACTIVE") sharedBlockers.push("The purchased inventory package must be active.");
  if (!inventoryFrom || !inventoryTo) sharedBlockers.push("The inventory package needs valid effective dates.");
  if (!inventoryZoneIds.length) sharedBlockers.push("The inventory targets do not contain an eligible playback zone.");
  if (!(inventory.dayparts || []).length) sharedBlockers.push("The inventory package needs at least one eligible daypart.");

  if (audio.required) {
    const campaign = audio.campaign;
    if (!campaign) audioBlockers.push("Link an audio campaign to this order.");
    else {
      if (campaign.status !== "PUBLISHED") audioBlockers.push("Publish the linked audio campaign.");
      if (!unique(audio.approvedPromoVersionIds).includes(campaign.promoVersionId)) audioBlockers.push("The campaign must use an approved audio creative from this order.");
      const campaignFrom = day(campaign.effectiveFrom);
      const campaignTo = day(campaign.effectiveTo);
      if (!campaignFrom || !campaignTo || campaignFrom < inventoryFrom || campaignTo > inventoryTo) audioBlockers.push("The audio campaign dates must stay inside the purchased inventory dates.");
      if (!unique(campaign.targetZoneIds).length) audioBlockers.push("The audio campaign has no eligible playback zones.");
      if (outsideInventory(campaign.targetZoneIds, inventoryZoneIds).length) audioBlockers.push("The audio campaign targets zones outside the purchased inventory.");
      const segments = (campaign.schedules || []).flatMap(scheduleSegments);
      if (!segments.length) audioBlockers.push("The audio campaign needs a delivery schedule.");
      else if (uncoveredSegments(segments, inventory.dayparts).length) audioBlockers.push("An audio campaign schedule falls outside the purchased dayparts.");
    }
  }

  if (visual.required) {
    const playlists = visual.playlists || [];
    if (!playlists.length) visualBlockers.push("Link at least one published visual playlist to this order.");
    const deliveredAssetIds = unique(playlists.flatMap((playlist) => playlist.assetIds || []));
    if (approvedAssetIds.some((assetId) => !deliveredAssetIds.includes(assetId))) visualBlockers.push("Every approved visual creative must appear in a linked playlist.");
    for (const playlist of playlists) {
      if (playlist.status !== "PUBLISHED") visualBlockers.push(`Publish visual playlist “${playlist.name || "Untitled"}”.`);
      if ((playlist.assetIds || []).some((assetId) => !approvedAssetIds.includes(assetId))) visualBlockers.push(`Playlist “${playlist.name || "Untitled"}” contains a visual outside this order.`);
      const starts = day(playlist.startsAt);
      const ends = day(playlist.endsAt);
      if (!starts || !ends || starts < inventoryFrom || ends > inventoryTo) visualBlockers.push(`Playlist “${playlist.name || "Untitled"}” dates must stay inside the purchased inventory dates.`);
      if (!unique(playlist.deviceZoneIds).length) visualBlockers.push(`Playlist “${playlist.name || "Untitled"}” has no assigned displays.`);
      if (outsideInventory(playlist.deviceZoneIds, inventoryZoneIds).length) visualBlockers.push(`Playlist “${playlist.name || "Untitled"}” targets displays outside the purchased inventory.`);
      const segments = visualSegments(playlist);
      if (!segments.length) visualBlockers.push(`Playlist “${playlist.name || "Untitled"}” needs active days.`);
      else if (uncoveredSegments(segments, inventory.dayparts).length) visualBlockers.push(`Playlist “${playlist.name || "Untitled"}” runs outside the purchased dayparts.`);
    }
  }

  const cleanAudio = unique(audioBlockers);
  const cleanVisual = unique(visualBlockers);
  const cleanShared = unique(sharedBlockers);
  const configuration = {
    orderId: input.orderId || null,
    inventory: { id: inventory.id || null, effectiveFrom: inventoryFrom, effectiveTo: inventoryTo, targetZoneIds: inventoryZoneIds, dayparts: [...(inventory.dayparts || [])].sort(bySchedule) },
    audio: { required: Boolean(audio.required), campaignId: audio.campaign?.id || null, targetZoneIds: unique(audio.campaign?.targetZoneIds), schedules: [...(audio.campaign?.schedules || [])].sort(bySchedule), approvedPromoVersionIds: unique(audio.approvedPromoVersionIds) },
    visual: { required: Boolean(visual.required), approvedAssetIds, playlists: (visual.playlists || []).map((playlist) => ({ id: playlist.id, version: playlist.version, assetIds: unique(playlist.assetIds), deviceZoneIds: unique(playlist.deviceZoneIds), startsAt: day(playlist.startsAt), endsAt: day(playlist.endsAt), activeDays: unique(playlist.activeDays), dailyStartMinute: playlist.dailyStartMinute, dailyEndMinute: playlist.dailyEndMinute })) }
  };
  const audioReady = !audio.required || (!cleanShared.length && !cleanAudio.length);
  const visualReady = !visual.required || (!cleanShared.length && !cleanVisual.length);
  return {
    orderId: input.orderId || null,
    audio: { required: Boolean(audio.required), ready: audioReady, blockers: cleanAudio },
    visual: { required: Boolean(visual.required), ready: visualReady, blockers: cleanVisual },
    sharedBlockers: cleanShared,
    canActivate: !cleanShared.length && audioReady && visualReady && (audio.required || visual.required),
    configurationHash: crossMediaConfigurationHash(configuration),
    evidenceNotice: "Activation confirms an eligible delivery configuration. Audio and visual proof remain separate device-confirmed events and do not measure audience."
  };
}
