import { randomUUID } from "node:crypto";
import { isRetailSubscriberContext, resolveRetailSubscriberWorkspace, RETAIL_SUBSCRIBER_STATION_ID as STATION, RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "./retail-subscriber-access.mjs";
import { loadRetailPilotAccess } from "./retail-stream-pilot-access.mjs";
import { resolveEntitlements } from "./entitlements.mjs";
import { loadEligibleSubscriberMusic } from "./subscriber-playlist-service.mjs";
import { subscriberMediaIdentity } from "./subscriber-stream-transport.mjs";
import { genreCodesForTrack, licensedGenresForLevel, normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { buildGenreRotation } from "./subscriber-playlists.mjs";
import { smartPlaylistSlug } from "./smart-playlists.mjs";
import { CONTINUOUS_SCHEDULE as S, scheduleHash, parseContinuousSchedule, scheduleFormItems,
  compileContinuousSchedule, buildContinuousScheduleSnapshot } from "./test-radio-continuous-schedule-policy.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { retailNormalPlanningVersion } from "./retail-schedule-draft-policy.mjs";

export const RETAIL_SUBSCRIBER_LIBRARY_LIMITS = Object.freeze({ maximumRecipes: 20, maximumRecipeTracks: 64, maximumPreviewItems: 200, maximumDurationMinutes: 180 });
const L = RETAIL_SUBSCRIBER_LIBRARY_LIMITS;
export const retailSubscriberError = code => Object.assign(new Error(code), { code });
const fail = code => { throw retailSubscriberError(code); };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const text = (value, fallback = "") => String(value || fallback).slice(0, 300);
const codes = values => Array.isArray(values) && values.length > 0 && values.length <= 48 && values.every(code => typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code));
const recipeWhere = () => ({ organisationId: ORG, source: "SMART_PLAYLIST", status: { in: ["DRAFT", "ACTIVE"] }, smartPlaylist: {
  organisationId: ORG, status: { in: ["DRAFT", "ACTIVE"] }, rightsUse: "RETAIL_RADIO", simpleBuildMode: { in: ["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"] } } });
const versionInclude = { items: { orderBy: { position: "asc" }, take: 201 } };

async function scope(db, { context, now = new Date(), env = process.env } = {}) {
  const workspace = await resolveRetailSubscriberWorkspace(db, context, { now });
  if (!workspace) fail("SUBSCRIBER_ACCESS_DENIED");
  const station = await db.station.findUnique({ where: { id: STATION }, include: { streamConfig: true } });
  if (station?.id !== STATION || station.organisationId !== ORG || station.productFamily !== "RETAIL") fail("SUBSCRIBER_ACCESS_DENIED");
  // This independent signed music permission remains usable while playback is
  // stopped. Never require/mint a START grant, lease, source probe or worker.
  const permission = await loadRetailPilotAccess(db, { station, now, env });
  if (!permission?.approved) fail("SUBSCRIBER_MUSIC_ACCESS_REQUIRED");
  const configuredGenres = await db.mediaGenre.findMany({ where: { active: true }, select: {
    slug: true, name: true, active: true, minimumCatalogueLevel: true }, take: 501 });
  if (configuredGenres.length > 500) fail("SUBSCRIBER_CATALOGUE_REVIEW_REQUIRED");
  const permitted = new Map(licensedGenresForLevel(permission.catalogueLevel, configuredGenres).map(g => [g.code, g.label]));
  const rows = await loadEligibleSubscriberMusic(db, { organisationId: ORG, requiredUse: "RETAIL_RADIO", territory: permission.territory,
    catalogueLevel: permission.catalogueLevel, sourceScopes: permission.sourceScopes, configuredGenres, instant: now });
  if (rows.length >= 5000) fail("SUBSCRIBER_CATALOGUE_REVIEW_REQUIRED");
  const assets = new Set(), recordings = new Set(), entries = [];
  for (const { track } of rows) {
    const asset = track.mediaAsset, durationSeconds = Number(asset?.durationSeconds);
    if (track.rightsReviewStatus !== "APPROVED" || !Number.isFinite(durationSeconds) || durationSeconds <= 2 || durationSeconds > 3600) continue;
    let identity; try { identity = subscriberMediaIdentity(asset); } catch { continue; }
    const genreCodes = genreCodesForTrack(track).filter(code => permitted.has(code));
    if (!genreCodes.length || assets.has(asset.id) || recordings.has(identity.checksum)) continue;
    assets.add(asset.id); recordings.add(identity.checksum);
    entries.push({ track, durationSeconds, genreCodes, fingerprint: scheduleHash([track.id, asset.id, identity.checksum, durationSeconds]) });
  }
  if (entries.length > S.maximumTracks) fail("SUBSCRIBER_CATALOGUE_REVIEW_REQUIRED");
  const genres = [...permitted].map(([code, name]) => ({ code, name, eligibleTrackCount: entries.filter(e => e.genreCodes.includes(code)).length }))
    .filter(g => g.eligibleTrackCount).sort((a, b) => a.name.localeCompare(b.name));
  return { workspace, station, organisationId: ORG, actorId: context.session.userId, permission, entries, genres };
}
function parseRecipe(input) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name) ||
    !["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"].includes(input?.buildMode) || !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1 || input.durationMinutes > L.maximumDurationMinutes || !codes(input.genreCodes)) fail("LIBRARY_RECIPE_INVALID");
  const genreCodes = input.genreCodes.map(normaliseGenreCode);
  if (input.buildMode === "RANDOM_GENRE_POOL" && new Set(genreCodes).size !== genreCodes.length) fail("LIBRARY_RECIPE_INVALID");
  return { name, buildMode: input.buildMode, genreCodes, durationMinutes: input.durationMinutes };
}
// Do not reuse the Online-only simpleScheduleSource predicate or relabel data.
function retailSource(mode) {
  const recipe = mode?.smartPlaylist;
  if (!mode || mode.organisationId !== ORG || mode.source !== "SMART_PLAYLIST" || !["DRAFT", "ACTIVE"].includes(mode.status) ||
    !recipe || recipe.organisationId !== ORG || recipe.musicModeId !== mode.id || !["DRAFT", "ACTIVE"].includes(recipe.status) ||
    recipe.rightsUse !== "RETAIL_RADIO" || !["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"].includes(recipe.simpleBuildMode) || !codes(recipe.genreCodes)) return null;
  return { id: mode.id, name: text(mode.name), buildMode: recipe.simpleBuildMode, genreCodes: recipe.genreCodes.map(normaliseGenreCode) };
}
function pool(ctx, recipe) {
  if (recipe.genreCodes.some(code => !ctx.genres.some(g => g.code === code))) fail("LIBRARY_GENRE_UNAVAILABLE");
  const entries = ctx.entries.filter(e => e.genreCodes.some(code => recipe.genreCodes.includes(code)));
  if (!entries.length) fail("LIBRARY_NO_APPROVED_MUSIC");
  if (entries.length > L.maximumRecipeTracks) fail("LIBRARY_RECIPE_TOO_LARGE");
  if (Math.ceil(recipe.durationMinutes * 60 / Math.max(.25, Math.min(...entries.map(e => e.durationSeconds)) - 1)) > 3900) fail("LIBRARY_PROGRAMME_TOO_DENSE");
  return entries;
}
function safeRecipe(mode, ctx) {
  const source = retailSource(mode); if (!source) return null;
  const eligible = ctx.entries.filter(e => e.genreCodes.some(code => source.genreCodes.includes(code)));
  let readyForSchedule = Number.isInteger(mode.smartPlaylist.durationMinutes) && mode.smartPlaylist.durationMinutes > 0;
  try { pool(ctx, { ...source, durationMinutes: mode.smartPlaylist.durationMinutes || 60 }); } catch { readyForSchedule = false; }
  return { sourceId: mode.id, playlistId: mode.smartPlaylist.id, name: source.name, version: mode.smartPlaylist.version,
    buildMode: source.buildMode, genreCodes: source.genreCodes, durationMinutes: mode.smartPlaylist.durationMinutes,
    eligibleTrackCount: eligible.length, eligibleDurationSeconds: eligible.reduce((n, e) => n + e.durationSeconds, 0),
    unavailableGenreCodes: [...new Set(source.genreCodes.filter(code => !eligible.some(e => e.genreCodes.includes(code))))], readyForSchedule };
}
async function modesFor(db) { return db.musicMode.findMany({ where: recipeWhere(), include: { smartPlaylist: true }, orderBy: { name: "asc" }, take: L.maximumRecipes + 1 }); }
async function libraryDto(db, ctx) {
  const modes = await modesFor(db), recipes = modes.map(mode => safeRecipe(mode, ctx)).filter(Boolean), warnings = [];
  if (modes.length >= L.maximumRecipes) warnings.push("The 20-playlist limit has been reached. Load an existing playlist; no new copy will be created.");
  if (recipes.some(r => !r.readyForSchedule)) warnings.push("Some playlists need currently approved music or a narrower genre selection before scheduling.");
  return { stationId: STATION, draftOnly: true, recipes, genres: ctx.genres, limits: L, warnings };
}
export async function retailSubscriberLibrary(db, options) { return libraryDto(db, await scope(db, options)); }
export async function retailSubscriberCatalogue(db, { query = {}, ...options }) {
  const ctx = await scope(db, options);
  if (Object.keys(query).some(key => !["q", "genre", "limit", "offset"].includes(key)) ||
    (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 100)) ||
    (query.genre !== undefined && query.genre !== "" && (typeof query.genre !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(query.genre)))) fail("SUBSCRIBER_QUERY_INVALID");
  const limit = query.limit === undefined ? 50 : Number(query.limit), offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 2000) fail("SUBSCRIBER_QUERY_INVALID");
  const q = (query.q || "").trim().toLowerCase(), genre = normaliseGenreCode(query.genre || "");
  const selected = ctx.entries.filter(e => (!genre || e.genreCodes.includes(genre)) && (!q ||
    [e.track.title, e.track.artist, e.track.album, e.track.mixName].some(value => String(value || "").toLowerCase().includes(q))))
    .sort((a, b) => String(a.track.title || "").localeCompare(String(b.track.title || "")) || a.track.id.localeCompare(b.track.id));
  return { stationId: STATION, stationName: text(ctx.workspace.stationName), metadataOnly: true, territory: ctx.permission.territory,
    catalogueLevel: ctx.permission.catalogueLevel, limit, offset, total: selected.length, genres: ctx.genres, warnings: [],
    tracks: selected.slice(offset, offset + limit).map(({ track, durationSeconds, genreCodes }) => ({ id: track.id,
      title: text(track.title, "Untitled"), artist: text(track.artist, "Unknown artist"), album: text(track.album), mix: text(track.mixName),
      durationSeconds, bpm: Number.isFinite(track.bpm) ? track.bpm : null, genreCodes, explicit: track.isExplicit === true,
      source: track.mediaAsset.licensedCatalogue ? "Licensed catalogue" : "Ruvanas catalogue" })) };
}
export async function retailSubscriberPreviewRecipe(db, { input, ...options }) {
  const ctx = await scope(db, options), recipe = parseRecipe(input), entries = pool(ctx, recipe);
  if (input.seed !== undefined && (typeof input.seed !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.seed))) fail("LIBRARY_RECIPE_INVALID");
  const seed = input.seed || randomUUID(), generated = buildGenreRotation({ entries, ...recipe, seed });
  const items = generated.entries.slice(0, L.maximumPreviewItems).map((entry, position) => ({ position, trackId: entry.track.id,
    title: text(entry.track.title, "Untitled"), artist: text(entry.track.artist, "Unknown artist"), durationSeconds: entry.durationSeconds, genreCodes: entry.genreCodes }));
  const totalDurationSeconds = items.reduce((n, e) => n + e.durationSeconds, 0), requestedDurationSeconds = recipe.durationMinutes * 60;
  const truncated = generated.entries.length > items.length || totalDurationSeconds < requestedDurationSeconds;
  return { stationId: STATION, preview: { seed, items, totalDurationSeconds, requestedDurationSeconds, truncated, liveOrderFixed: false,
    warnings: [...generated.warnings, "Example order only. This metadata preview does not play audio or change the live Retail stream.",
      ...(truncated ? ["Preview limited to 200 rows; saved playlists are reusable genre templates, not a fixed live order."] : [])] } };
}
function auditId(kind, input, ctx) {
  if (typeof input?.requestId !== "string" || !UUID.test(input.requestId)) fail("SUBSCRIBER_REQUEST_ID_REQUIRED");
  return `test-retail-subscriber-${kind}-${scheduleHash([STATION, ctx.actorId, input.requestId.toLowerCase()]).slice(0, 40)}`;
}
function retryMatches(previous, ctx, hash, action) {
  if (previous.action !== action || previous.organisationId !== ORG || previous.actorUserId !== ctx.actorId ||
    previous.details?.stationId !== STATION || previous.details?.requestHash !== hash) fail("SUBSCRIBER_RETRY_CHANGED");
}
export async function retailSubscriberCreateRecipe(db, { input, now = new Date(), ...options }) {
  const recipe = parseRecipe(input);
  const savedSourceId = await runSerializableTransaction(db, async tx => {
    const ctx = await scope(tx, { ...options, now }), id = auditId("recipe", input, ctx), hash = scheduleHash([ORG, recipe]);
    const previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) {
      retryMatches(previous, ctx, hash, "TEST_RETAIL_SUBSCRIBER_RECIPE_CREATED");
      const mode = await tx.musicMode.findFirst({ where: { id: previous.details.sourceId, ...recipeWhere() }, include: { smartPlaylist: true } });
      if (!safeRecipe(mode, ctx) || mode.smartPlaylist.id !== previous.entityId) fail("LIBRARY_SAVED_RECIPE_UNAVAILABLE");
      return mode.id;
    }
    pool(ctx, recipe);
    if (await tx.musicMode.count({ where: recipeWhere() }) >= L.maximumRecipes) fail("LIBRARY_RECIPE_LIMIT");
    let slug; try { slug = smartPlaylistSlug(recipe.name); } catch { slug = "music-template"; }
    const mode = await tx.musicMode.create({ data: { organisationId: ORG, name: recipe.name,
      slug: `test-retail-${slug}-${randomUUID().slice(0, 8)}`, source: "SMART_PLAYLIST", status: "DRAFT",
      description: "Private Retail playlist draft. Administrator approval is separate; saving never changes live output." } });
    const playlist = await tx.smartPlaylist.create({ data: { organisationId: ORG, musicModeId: mode.id, createdByUserId: ctx.actorId,
      status: "DRAFT", rightsUse: "RETAIL_RADIO", territory: ctx.permission.territory,
      simpleBuildMode: recipe.buildMode, genreCodes: recipe.genreCodes, durationMinutes: recipe.durationMinutes } });
    await tx.auditLog.create({ data: { id, organisationId: ORG, actorUserId: ctx.actorId, action: "TEST_RETAIL_SUBSCRIBER_RECIPE_CREATED",
      entityType: "SmartPlaylist", entityId: playlist.id, createdAt: now, details: { stationId: STATION, sourceId: mode.id, requestHash: hash } } });
    return mode.id;
  });
  return { ...await retailSubscriberLibrary(db, { ...options, now }), savedSourceId };
}
const workspaceDto = ctx => ({ ...ctx.workspace, draftOnly: true, canPrepare: ctx.workspace.channels.length === 0 });
export async function retailSubscriberWorkspace(db, options) { return workspaceDto(await scope(db, options)); }
export async function retailSubscriberPrepareWorkspace(db, { input, now = new Date(), ...options }) {
  if (input?.action !== "prepare") fail("SUBSCRIBER_BODY_INVALID");
  if (!isRetailSubscriberContext(options.context, now)) fail("SUBSCRIBER_ACCESS_DENIED");
  const preparedChannelId = await runSerializableTransaction(db, async tx => {
    // A separate planning lock cannot seize the live worker's connection/lease.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-subscriber-planning:${ORG}`}))`;
    const ctx = await scope(tx, { ...options, now }), id = auditId("workspace", input, ctx), hash = scheduleHash([ORG, STATION]);
    const previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) {
      retryMatches(previous, ctx, hash, "TEST_RETAIL_SUBSCRIBER_WORKSPACE_PREPARED");
      if (ctx.workspace.channelId !== previous.entityId) fail("SUBSCRIBER_WORKSPACE_REVIEW_REQUIRED");
      return previous.entityId;
    }
    if (ctx.workspace.channelId) return ctx.workspace.channelId;
    const entitlements = resolveEntitlements(options.context.membership.organisation.subscription, now);
    const count = await tx.station.count({ where: { organisationId: ORG } });
    if (!Number.isInteger(entitlements.stationLimit) || entitlements.stationLimit < 1 || !Number.isInteger(count) || count < 1 || count > entitlements.stationLimit)
      fail("SUBSCRIBER_STATION_LIMIT");
    const channel = await tx.channel.create({ data: { organisationId: ORG, stationId: STATION, musicRightsUse: "RETAIL_RADIO",
      name: "Test Retail planning", slug: "test-retail-private-planning", status: "DRAFT",
      description: "Private weekly planning only. Not an active output channel." } });
    await tx.auditLog.create({ data: { id, organisationId: ORG, actorUserId: ctx.actorId, action: "TEST_RETAIL_SUBSCRIBER_WORKSPACE_PREPARED",
      entityType: "Channel", entityId: channel.id, createdAt: now, details: { stationId: STATION, requestHash: hash, draftOnly: true } } });
    return channel.id;
  });
  return { ...await retailSubscriberWorkspace(db, { ...options, now }), preparedChannelId };
}
async function scheduleContext(db, options) {
  const ctx = await scope(db, options), channelId = options.channelId || ctx.workspace.channelId;
  if (channelId && !ctx.workspace.channels.some(c => c.id === channelId)) fail("SCHEDULE_CHANNEL_INVALID");
  const modes = await modesFor(db); if (modes.length > S.maximumSources) fail("SCHEDULE_SOURCE_LIMIT");
  const sources = modes.map(mode => { const source = retailSource(mode), recipe = safeRecipe(mode, ctx);
    return source && recipe ? { ...source, eligibleTrackCount: recipe.eligibleTrackCount, eligibleDurationSeconds: recipe.eligibleDurationSeconds,
      unavailableGenreCodes: recipe.unavailableGenreCodes, readyForSchedule: recipe.readyForSchedule } : null; }).filter(Boolean);
  const schedule = channelId ? await db.programmeSchedule.findFirst({ where: { organisationId: ORG, channelId },
    include: { versions: { orderBy: { version: "desc" }, take: S.maximumVersions + 1, include: versionInclude } } }) : null;
  if (schedule && (schedule.organisationId !== ORG || schedule.channelId !== channelId)) fail("SUBSCRIBER_ACCESS_DENIED");
  if (schedule?.versions.length > S.maximumVersions) fail("SCHEDULE_VERSION_LIMIT");
  const highestVersion = schedule?.versions?.[0]?.version || 0;
  const planningVersion = schedule ? await retailNormalPlanningVersion(db, schedule.versions) : null;
  return { ...ctx, channelId, sources, highestVersion, schedule: schedule ? { ...schedule, versions: planningVersion ? [planningVersion] : [] } : null };
}
export async function retailSubscriberSchedule(db, { now = new Date(), ...options }) {
  const ctx = await scheduleContext(db, { ...options, now }), warnings = []; let draft = null;
  const version = ctx.schedule?.versions?.[0];
  if (version) {
    let preview = null;
    try {
      const parsed = parseContinuousSchedule({ channelId: ctx.channelId, name: ctx.schedule.name, timezone: ctx.schedule.timezone, items: scheduleFormItems(version.items) });
      const compiled = compileContinuousSchedule({ items: parsed.items.map((item, i) => ({ ...item, id: version.items[i].id })) }, { timezone: ctx.schedule.timezone, startsAt: now, days: 7 });
      buildContinuousScheduleSnapshot({ stationId: STATION, organisationId: ORG, channelId: ctx.channelId,
        schedule: ctx.schedule, version, sources: ctx.sources, authorizedTracks: ctx.entries });
      preview = { timezone: compiled.timezone, startsAt: compiled.startsAt.toISOString(), endsAt: compiled.endsAt.toISOString(), days: compiled.days,
        occurrences: compiled.occurrences.map(item => ({ label: item.label, startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), sourceId: item.sourceId, priority: item.priority })), warnings: compiled.warnings };
      warnings.push(...compiled.warnings);
    } catch { warnings.push("The saved draft needs a current music or timing review before administrator approval."); }
    draft = { id: version.id, version: version.version, items: scheduleFormItems(version.items), reviewHash: null, readyToApprove: false, preview };
  }
  if (!ctx.channelId) warnings.push("Prepare the private planning workspace before saving your week. Preparation does not start, stop or change the stream.");
  warnings.push("Saving creates a private draft only. Administrator approval is a separate step before any live schedule can change.",
    "Live programme status is not shown here; these controls manage private drafts only.");
  return { stationId: STATION, channels: ctx.workspace.channels, sources: ctx.sources,
    schedule: ctx.schedule ? { id: ctx.schedule.id, name: text(ctx.schedule.name), timezone: ctx.schedule.timezone, channelId: ctx.channelId } : null,
    draft, approved: null, nowNext: null, canEdit: Boolean(ctx.channelId), canApprove: false, draftOnly: true, warnings: [...new Set(warnings)] };
}
export async function retailSubscriberSaveSchedule(db, { input, now = new Date(), ...options }) {
  const parsed = parseContinuousSchedule(input);
  if (input.baseVersionId !== null && (typeof input.baseVersionId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/.test(input.baseVersionId))) fail("SUBSCRIBER_BASE_VERSION_REQUIRED");
  const savedVersionId = await runSerializableTransaction(db, async tx => {
    const ctx = await scheduleContext(tx, { ...options, now, channelId: parsed.channelId }), id = auditId("week", input, ctx);
    const hash = scheduleHash([ORG, parsed, input.baseVersionId]), previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) {
      retryMatches(previous, ctx, hash, "TEST_RETAIL_SUBSCRIBER_WEEKLY_DRAFT");
      if (ctx.schedule?.versions?.[0]?.id !== previous.entityId) fail("SUBSCRIBER_DRAFT_CHANGED");
      return previous.entityId;
    }
    if (!ctx.channelId) fail("SCHEDULE_CHANNEL_INVALID");
    if ((ctx.schedule?.versions?.[0]?.id || null) !== input.baseVersionId) fail("SUBSCRIBER_DRAFT_CHANGED");
    if (parsed.items.some(item => !ctx.sources.some(source => source.id === item.musicModeId && source.readyForSchedule))) fail("SCHEDULE_SOURCE_UNAVAILABLE");
    const highest = ctx.highestVersion;
    if (highest >= S.maximumVersions) fail("SCHEDULE_VERSION_LIMIT");
    if (ctx.schedule && (ctx.schedule.timezone !== parsed.timezone || ctx.schedule.name !== parsed.name)) fail("SCHEDULE_HEADER_IMMUTABLE");
    let schedule = ctx.schedule;
    if (!schedule) schedule = await tx.programmeSchedule.create({ data: { organisationId: ORG, channelId: parsed.channelId,
      name: parsed.name, timezone: parsed.timezone, createdByUserId: ctx.actorId } });
    // Append only. No active/published recipe, header, channel or version edit.
    const version = await tx.programmeScheduleVersion.create({ data: { organisationId: ORG, scheduleId: schedule.id,
      version: highest + 1, status: "DRAFT", isActive: false, createdByUserId: ctx.actorId, items: { create: parsed.items } } });
    await tx.auditLog.create({ data: { id, organisationId: ORG, actorUserId: ctx.actorId, action: "TEST_RETAIL_SUBSCRIBER_WEEKLY_DRAFT",
      entityType: "ProgrammeScheduleVersion", entityId: version.id, createdAt: now,
      details: { stationId: STATION, channelId: parsed.channelId, scheduleId: schedule.id, requestHash: hash } } });
    return version.id;
  });
  return { ...await retailSubscriberSchedule(db, { ...options, channelId: parsed.channelId, now }), savedVersionId };
}
const MESSAGES = Object.freeze({
  SUBSCRIBER_ACCESS_DENIED: "Sign in with Test Retail's current authorised subscriber account.",
  SUBSCRIBER_MUSIC_ACCESS_REQUIRED: "Ask your administrator to review Test Retail's current music access. No stream setting was changed.",
  SUBSCRIBER_QUERY_INVALID: "Use a shorter search or a valid catalogue page.",
  SUBSCRIBER_ORIGIN_INVALID: "Open these controls on the main Ruvanas website before saving.",
  SUBSCRIBER_BODY_INVALID: "Use the current draft controls and submit only their allowed fields.",
  SUBSCRIBER_REQUEST_ID_REQUIRED: "Refresh these controls before saving a new draft.",
  SUBSCRIBER_BASE_VERSION_REQUIRED: "Load the latest saved week before editing.",
  SUBSCRIBER_DRAFT_CHANGED: "The saved week changed in another window. Reload it before saving.",
  SUBSCRIBER_RETRY_CHANGED: "The earlier save used different settings. Refresh before saving a changed draft.",
  SUBSCRIBER_WORKSPACE_REVIEW_REQUIRED: "The planning channel needs administrator review. No live stream was changed.",
  SUBSCRIBER_STATION_LIMIT: "The current station allowance needs administrator review; no limit was changed.",
  SUBSCRIBER_CATALOGUE_REVIEW_REQUIRED: "The catalogue needs administrator review before these draft tools can continue.",
  LIBRARY_RECIPE_INVALID: "Enter a name, 1–180 minutes and a valid random mix or genre sequence.",
  LIBRARY_GENRE_UNAVAILABLE: "Choose genres with currently approved Retail recordings.",
  LIBRARY_NO_APPROVED_MUSIC: "No approved Retail recordings currently match this playlist.",
  LIBRARY_RECIPE_TOO_LARGE: "Choose fewer genres so this playlist uses no more than 64 recordings.",
  LIBRARY_PROGRAMME_TOO_DENSE: "Choose a shorter playlist for these very short recordings.",
  LIBRARY_RECIPE_LIMIT: "This workspace already has 20 playlists. Load an existing one.",
  LIBRARY_SAVED_RECIPE_UNAVAILABLE: "The earlier saved playlist is no longer available. Refresh before retrying.",
  SCHEDULE_INPUT_INVALID: "Review the programme times, names and playlist choices.",
  SCHEDULE_CHANNEL_INVALID: "Prepare or choose Test Retail's private planning channel.",
  SCHEDULE_SOURCE_UNAVAILABLE: "Choose a currently available Retail playlist before saving the week.",
  SCHEDULE_SOURCE_LIMIT: "The playlist count needs administrator review before weekly planning.",
  SCHEDULE_VERSION_LIMIT: "The saved-version limit needs administrator review.",
  SCHEDULE_HEADER_IMMUTABLE: "Keep the saved week name and time zone unchanged; only its programme draft can be revised here.",
  SUBSCRIBER_REQUEST_FAILED: "The request could not be confirmed. Refresh the saved draft before retrying. The live stream was not changed."
});
export function retailSubscriberPublicError(error) {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : "SUBSCRIBER_REQUEST_FAILED";
  return { error: MESSAGES[code], code };
}
