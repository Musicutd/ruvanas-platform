// The Broadcast Console is a view and command surface over existing programme authorities.
// These helpers deliberately do not create schedule, playback or proof-of-play decisions.

export const STUDIO_CONSOLE_LAYOUTS = Object.freeze({
  PRESENTER: ["ON_AIR", "DAILY_LOG", "CARTS", "NOTES", "OUTPUT_HEALTH"],
  PRODUCER: ["ON_AIR", "PREPARE", "DAILY_LOG", "RADIO_CLOCKS", "NOTES", "MIX_POINTS", "OUTPUT_HEALTH"],
  AUTOMATION: ["ON_AIR", "DAILY_LOG", "RADIO_CLOCKS", "OUTPUT_HEALTH"],
  COMPACT: ["ON_AIR", "CARTS", "OUTPUT_HEALTH"],
  DUAL_SCREEN: ["ON_AIR", "DAILY_LOG", "OUTPUT_HEALTH", "PREPARE", "CARTS", "RADIO_CLOCKS", "NOTES", "MIX_POINTS"]
});

export const STUDIO_CONSOLE_PANELS = Object.freeze([...new Set(Object.values(STUDIO_CONSOLE_LAYOUTS).flat())]);
export const STUDIO_CONSOLE_PANEL_GROUPS = Object.freeze({
  PRIMARY: ["ON_AIR", "DAILY_LOG", "OUTPUT_HEALTH"],
  TOOLS: ["PREPARE", "CARTS", "RADIO_CLOCKS", "NOTES", "MIX_POINTS"]
});
export const STUDIO_MIX_POINT_TYPES = Object.freeze(["CUE_IN", "INTRO_END", "MIX_START", "FADE_START", "END"]);
export const STUDIO_CART_BEHAVIOURS = Object.freeze(["PLAY_ONCE", "LOOP", "FADE"]);

export function normalizeStudioConsoleLayout(input = {}) {
  const preset = Object.hasOwn(STUDIO_CONSOLE_LAYOUTS, input.preset) ? input.preset : "PRESENTER";
  const proposed = Array.isArray(input.panels) ? input.panels : STUDIO_CONSOLE_LAYOUTS[preset];
  const panels = [...new Set(proposed.filter((panel) => STUDIO_CONSOLE_PANELS.includes(panel)))];
  for (const required of ["ON_AIR", "OUTPUT_HEALTH"]) if (!panels.includes(required)) panels.unshift(required);
  const sizes = {};
  if (input.sizes && typeof input.sizes === "object" && !Array.isArray(input.sizes)) {
    for (const [key, value] of Object.entries(input.sizes)) {
      if (panels.includes(key) && Number.isFinite(Number(value))) sizes[key] = Math.max(240, Math.min(1200, Math.round(Number(value))));
    }
  }
  return { preset, panels, sizes };
}

export function moveStudioConsolePanel(input, panelId, direction) {
  const layout = normalizeStudioConsoleLayout(input);
  if (direction !== -1 && direction !== 1) return layout;
  const group = Object.values(STUDIO_CONSOLE_PANEL_GROUPS).find((panels) => panels.includes(panelId));
  if (!group) return layout;
  const visible = layout.panels.filter((id) => group.includes(id));
  const from = visible.indexOf(panelId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= visible.length) return layout;
  const panels = [...layout.panels];
  const first = panels.indexOf(visible[from]);
  const second = panels.indexOf(visible[to]);
  [panels[first], panels[second]] = [panels[second], panels[first]];
  return { ...layout, panels };
}

export function validateStudioMixPoints(points, durationMs) {
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0) return { valid: false, reason: "Unknown media duration", points: {} };
  const selected = {};
  for (const point of points || []) {
    if (!STUDIO_MIX_POINT_TYPES.includes(point?.type) || selected[point.type] !== undefined) return { valid: false, reason: "Duplicate or unknown mix point", points: {} };
    const positionMs = Number(point.positionMs);
    if (!Number.isInteger(positionMs) || positionMs < 0 || positionMs > duration) return { valid: false, reason: "Mix point outside media", points: {} };
    selected[point.type] = positionMs;
  }
  const order = STUDIO_MIX_POINT_TYPES.map((type) => selected[type]).filter((value) => value !== undefined);
  if (order.some((position, index) => index > 0 && position < order[index - 1])) return { valid: false, reason: "Mix points are out of order", points: {} };
  if (selected.CUE_IN !== undefined && selected.END !== undefined && selected.CUE_IN >= selected.END) return { valid: false, reason: "Cue must precede end", points: {} };
  return { valid: true, reason: null, points: selected };
}

export function safeStudioMixTiming(points, durationMs) {
  const assessed = validateStudioMixPoints(points, durationMs);
  if (!assessed.valid) return { cueInMs: 0, introEndMs: null, mixStartMs: null, fadeStartMs: null, endMs: Number(durationMs) || null, fallback: true };
  return {
    cueInMs: assessed.points.CUE_IN ?? 0,
    introEndMs: assessed.points.INTRO_END ?? null,
    mixStartMs: assessed.points.MIX_START ?? null,
    fadeStartMs: assessed.points.FADE_START ?? null,
    endMs: assessed.points.END ?? Number(durationMs),
    fallback: false
  };
}

export function studioMixDefaults(points, durationMs) {
  const timing = safeStudioMixTiming(points, durationMs);
  if (timing.fallback) return {};
  const end = timing.endMs;
  return {
    cueInMs: timing.cueInMs,
    cueOutMs: end,
    fadeOutMs: timing.fadeStartMs == null ? 0 : Math.max(0, end - timing.fadeStartMs)
  };
}

export function studioConsoleNowNext(session) {
  const items = session?.items || [];
  const onAir = items.find((item) => item.status === "ON_AIR") || null;
  const future = items.filter((item) => item.area === "LIVE" && item.status === "READY").sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)));
  return { onAir, next: future[0] || null, afterNext: future[1] || null, future };
}

export function deriveStudioDailyLog({ scheduled = [], generated = [], campaigns = [], live = [], manual = [], proof = [], dayStart, dayEnd } = {}) {
  const lower = new Date(dayStart).getTime();
  const upper = new Date(dayEnd).getTime();
  const planned = [...scheduled, ...generated, ...campaigns, ...live, ...manual]
    .filter((item) => {
      const time = new Date(item.plannedStartAt || item.startsAt).getTime();
      return Number.isFinite(time) && time >= lower && time < upper;
    })
    .map((item) => ({
      id: String(item.id), sourceType: String(item.sourceType), sourceId: String(item.sourceId || item.id),
      label: String(item.label || "Untitled item"), plannedStartAt: new Date(item.plannedStartAt || item.startsAt).toISOString(),
      durationMs: Math.max(0, Number(item.durationMs || 0)), locked: item.locked === true || item.hardEvent === true,
      hardEvent: item.hardEvent === true, rightsReady: item.rightsReady !== false,
      actualStartAt: null, estimatedStartAt: null, timingVarianceMs: null, status: "PLANNED"
    }))
    .sort((a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt) || Number(b.hardEvent) - Number(a.hardEvent) || a.id.localeCompare(b.id));
  let cursor = lower;
  for (const item of planned) {
    const plannedMs = new Date(item.plannedStartAt).getTime();
    const estimatedMs = item.hardEvent ? plannedMs : Math.max(plannedMs, cursor);
    item.estimatedStartAt = new Date(estimatedMs).toISOString();
    item.timingVarianceMs = estimatedMs - plannedMs;
    cursor = Math.max(cursor, estimatedMs + item.durationMs);
  }
  const actual = proof.filter((event) => {
    const time = new Date(event.occurredAt).getTime();
    return Number.isFinite(time) && time >= lower && time < upper;
  }).map((event) => ({ id: String(event.id), sourceType: "VERIFIED_PLAY", scheduleItemId: event.scheduleItemId || null, label: String(event.label || event.trackTitle || "Verified output"), actualStartAt: new Date(event.occurredAt).toISOString(), eventType: event.eventType, mediaAssetId: event.mediaAssetId || null }));
  return { planned, actual, nextHardEventAt: planned.find((item) => item.hardEvent && new Date(item.plannedStartAt).getTime() >= Date.now())?.plannedStartAt || null };
}

export function studioTimingToNextHardEvent(log, now = new Date()) {
  const next = (log?.planned || []).find((item) => item.hardEvent && new Date(item.plannedStartAt) > now);
  if (!next) return null;
  const preceding = (log.planned || []).filter((item) => new Date(item.estimatedStartAt) < new Date(next.plannedStartAt)).at(-1);
  const expectedFinish = preceding ? new Date(preceding.estimatedStartAt).getTime() + preceding.durationMs : now.getTime();
  return { hardEventAt: next.plannedStartAt, deltaMs: new Date(next.plannedStartAt).getTime() - expectedFinish };
}
