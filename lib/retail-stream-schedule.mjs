import { compileContinuousSchedule, canonicalScheduleItems, scheduleHash } from "./test-radio-continuous-schedule-policy.mjs";
import { normaliseGenreCode } from "./autodj-genre-entitlements.mjs";

const disabled = reasonCode => ({ enabled: false, reasonCode, occurrences: [] });

// Read only owner-published Retail plans. A subscriber's draft or another
// channel's schedule never becomes an on-air instruction through this loader.
export async function loadRetailStreamSchedule(db, { authorized, now = new Date() } = {}) {
  const { station, grant, tracks } = authorized || {};
  if (!station || station.productFamily !== "RETAIL" || station.id !== grant?.stationId ||
    station.organisationId !== grant?.organisationId || !Array.isArray(tracks)) return disabled("RETAIL_SCHEDULE_SCOPE_INVALID");
  const channels = await db.channel.findMany({ where: { stationId: station.id, organisationId: station.organisationId,
    musicRightsUse: "RETAIL_RADIO", status: "ACTIVE" }, select: { id: true, stationId: true, organisationId: true }, take: 2 });
  if (!channels.length) return disabled("RETAIL_SCHEDULE_NOT_CONFIGURED");
  if (channels.length !== 1 || channels[0].stationId !== station.id || channels[0].organisationId !== station.organisationId)
    return disabled("RETAIL_SCHEDULE_SCOPE_INVALID");
  const schedule = await db.programmeSchedule.findFirst({ where: { organisationId: station.organisationId, channelId: channels[0].id },
    include: { versions: { where: { status: "PUBLISHED", isActive: true }, take: 2, include: { publishedBy: { select: { id: true, role: true } },
      items: { orderBy: { position: "asc" }, include: { musicMode: { include: { smartPlaylist: true } } } } } } } });
  if (!schedule || !schedule.versions?.length) return disabled("RETAIL_SCHEDULE_NOT_APPROVED");
  const version = schedule.versions[0];
  if (schedule.organisationId !== station.organisationId || schedule.channelId !== channels[0].id || schedule.versions.length !== 1 ||
    version.organisationId !== station.organisationId || version.scheduleId !== schedule.id || version.status !== "PUBLISHED" ||
    !version.isActive || !version.publishedAt || version.publishedBy?.role !== "SUPER_ADMIN" || version.publishedBy.id !== version.publishedByUserId ||
    !Array.isArray(version.items) || !version.items.length || version.items.length > 200) return disabled("RETAIL_SCHEDULE_NOT_APPROVED");
  const sources = new Map();
  const publishedAtMs = new Date(version.publishedAt).getTime();
  if (!Number.isFinite(publishedAtMs) || publishedAtMs > now.getTime()) return disabled("RETAIL_SCHEDULE_NOT_APPROVED");
  for (const item of version.items) {
    const mode = item.musicMode, recipe = mode?.smartPlaylist;
    if (item.organisationId !== station.organisationId || item.versionId !== version.id || item.sourceType !== "MUSIC_MODE" ||
      item.musicModeId !== mode?.id || mode?.organisationId !== station.organisationId || mode.status !== "ACTIVE" ||
      recipe?.organisationId !== station.organisationId || recipe.musicModeId !== mode.id || recipe.status !== "ACTIVE" ||
      recipe.rightsUse !== "RETAIL_RADIO" || !["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"].includes(recipe.simpleBuildMode) ||
      !Array.isArray(recipe.genreCodes) || !recipe.genreCodes.length || recipe.genreCodes.length > 48 ||
      recipe.genreCodes.some(value => typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))) return disabled("RETAIL_SCHEDULE_SOURCE_UNAVAILABLE");
    // Publication currently references mutable recipes. Any later edit must
    // be approved by publishing a fresh schedule before it can reach audio.
    if ([item, mode, recipe].some(row => !row.updatedAt || !Number.isFinite(new Date(row.updatedAt).getTime()) ||
      new Date(row.updatedAt).getTime() > publishedAtMs)) return disabled("RETAIL_SCHEDULE_REAPPROVAL_REQUIRED");
    const genreCodes = recipe.genreCodes.map(normaliseGenreCode);
    const entries = tracks.map(entry => ({ trackId: entry.track.id, mediaAssetId: entry.track.mediaAssetId,
      fingerprint: entry.fingerprint, durationSeconds: entry.durationSeconds,
      genreCodes: (entry.track.mediaAsset?.genres || []).map(row => normaliseGenreCode(row.mediaGenre?.slug || "")).filter(Boolean) }))
      .filter(entry => entry.genreCodes.some(code => genreCodes.includes(code)));
    // Bounded precision measurement before handover; larger recipes need a
    // narrower selection, not unbounded storage downloads or guessed timing.
    if (!entries.length || entries.length > 64) return disabled("RETAIL_SCHEDULE_MEDIA_UNAVAILABLE");
    sources.set(mode.id, { tracks: entries, config: { buildMode: recipe.simpleBuildMode, genreCodes } });
  }
  let compiled;
  try { compiled = compileContinuousSchedule(version, { timezone: schedule.timezone, startsAt: now, days: 2 }); }
  catch { return disabled("RETAIL_SCHEDULE_INVALID"); }
  if (compiled.conflicts.some(row => row.severity === "BLOCKING")) return disabled("RETAIL_SCHEDULE_OVERLAP");
  const revisionFingerprint = scheduleHash({ stationId: station.id, organisationId: station.organisationId,
    versionId: version.id, items: canonicalScheduleItems(version.items), sources: [...sources] });
  const effectiveAt = new Date(Math.max(Date.parse(grant.issuedAt), new Date(version.publishedAt).getTime()));
  if (!Number.isFinite(effectiveAt.getTime())) return disabled("RETAIL_SCHEDULE_INVALID");
  return { enabled: true, stationId: station.id, channelId: channels[0].id, versionId: version.id, revisionFingerprint,
    effectiveAt: effectiveAt.toISOString(), validUntil: new Date(now.getTime() + 15000).toISOString(),
    occurrences: compiled.occurrences.filter(item => item.endsAt > now && item.startsAt >= effectiveAt && sources.has(item.sourceId)).map(item => ({
      id: scheduleHash([version.id, item.itemId, item.startsAt.toISOString()]), label: item.label, priority: item.priority,
      startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), ...sources.get(item.sourceId)
    })), warnings: compiled.warnings };
}
