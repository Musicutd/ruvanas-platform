import { randomUUID } from "node:crypto";
import { resolveTestRadioSubscriberWorkspace } from "./test-radio-subscriber-access.mjs";
import { TEST_RADIO_CONTINUOUS as P } from "./test-radio-continuous-policy.mjs";
import { CONTINUOUS_OBSERVATION_ID, loadAuthorizedContinuousRadio } from "./test-radio-continuous-service.mjs";
import { buildTestRadioNowNext } from "./test-radio-now-next.mjs";
import { loadAuthorizedContinuousSchedule, scheduleMessage } from "./test-radio-continuous-schedule-service.mjs";
import { TEST_RADIO_LIBRARY_LIMITS as L, parseTestRadioRecipe, testRadioLibraryMessage } from "./test-radio-planner-library.mjs";
import { CONTINUOUS_SCHEDULE as S, simpleScheduleSource, scheduleHash, parseContinuousSchedule, scheduleFormItems,
  compileContinuousSchedule, buildContinuousScheduleSnapshot } from "./test-radio-continuous-schedule-policy.mjs";
import { genreCodesForTrack, licensedGenresForLevel, normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { buildGenreRotation } from "./subscriber-playlists.mjs";
import { smartPlaylistSlug } from "./smart-playlists.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export const subscriberError = code => Object.assign(new Error(code), { code });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const safeText = (value, fallback = "") => String(value || fallback).slice(0, 300);
const versionInclude = { items: { orderBy: { position: "asc" }, take: 201 } };
const recipeWhere = organisationId => ({ organisationId, source: "SMART_PLAYLIST", status: { in: ["DRAFT", "ACTIVE"] },
  smartPlaylist: { organisationId, status: { in: ["DRAFT", "ACTIVE"] }, rightsUse: "ONLINE_RADIO",
    simpleBuildMode: { in: ["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"] } } });

async function scope(db, { context, now = new Date(), env = process.env }) {
  const workspace = await resolveTestRadioSubscriberWorkspace(db, context, { now });
  if (!workspace) throw subscriberError("SUBSCRIBER_ACCESS_DENIED");
  // This is a read of an independently signed owner grant, never a grant made
  // by (or impersonating) the subscriber. Do not return its source or secrets.
  const authorized = await loadAuthorizedContinuousRadio(db, { now, env });
  const organisationId = context.membership.organisationId;
  if (workspace.stationId !== P.stationId || authorized.station.id !== P.stationId ||
    authorized.station.organisationId !== organisationId || authorized.grant.organisationId !== organisationId)
    throw subscriberError("SUBSCRIBER_ACCESS_DENIED");
  const permitted = new Map(licensedGenresForLevel(P.catalogueLevel, authorized.configuredGenres).map(g => [g.code, g.label]));
  const entries = authorized.tracks.map(entry => ({ ...entry, genreCodes: genreCodesForTrack(entry.track).filter(code => permitted.has(code)) }));
  const genres = [...permitted].map(([code, name]) => ({ code, name, eligibleTrackCount: entries.filter(e => e.genreCodes.includes(code)).length }))
    .filter(g => g.eligibleTrackCount).sort((a, b) => a.name.localeCompare(b.name));
  return { workspace, organisationId, authorized, entries, genres, actorId: context.session.userId };
}
function pool(ctx, recipe) {
  if (recipe.genreCodes.some(code => !ctx.genres.some(g => g.code === code))) throw subscriberError("LIBRARY_GENRE_UNAVAILABLE");
  const entries = ctx.entries.filter(e => e.genreCodes.some(code => recipe.genreCodes.includes(code)));
  if (!entries.length) throw subscriberError("LIBRARY_NO_APPROVED_MUSIC");
  if (entries.length > L.maximumRecipeTracks) throw subscriberError("LIBRARY_RECIPE_TOO_LARGE");
  if (Math.ceil(recipe.durationMinutes * 60 / Math.max(.25, Math.min(...entries.map(e => e.durationSeconds)) - 1)) > 3900)
    throw subscriberError("LIBRARY_PROGRAMME_TOO_DENSE");
  return entries;
}
function safeRecipe(mode, ctx) {
  const source = simpleScheduleSource(mode);
  if (!source || mode.organisationId !== ctx.organisationId) return null;
  const eligible = ctx.entries.filter(e => e.genreCodes.some(code => source.genreCodes.includes(code)));
  const eligibleTrackCount = eligible.length;
  let readyForSchedule = true;
  try { pool(ctx, { ...source, durationMinutes: mode.smartPlaylist.durationMinutes || 60 }); } catch { readyForSchedule = false; }
  return { sourceId: mode.id, playlistId: mode.smartPlaylist.id, name: source.name, version: mode.smartPlaylist.version,
    buildMode: source.buildMode, genreCodes: source.genreCodes, durationMinutes: mode.smartPlaylist.durationMinutes,
    eligibleTrackCount, eligibleDurationSeconds: eligible.reduce((total, entry) => total + entry.durationSeconds, 0),
    unavailableGenreCodes: [...new Set(source.genreCodes.filter(code => !eligible.some(entry => entry.genreCodes.includes(code))))], readyForSchedule };
}
async function modesFor(db, ctx) {
  return db.musicMode.findMany({ where: recipeWhere(ctx.organisationId), include: { smartPlaylist: true }, orderBy: { name: "asc" }, take: L.maximumRecipes + 1 });
}
async function libraryDto(db, ctx) {
  const modes = await modesFor(db, ctx), warnings = [];
  if (modes.length >= L.maximumRecipes) warnings.push("The 20-recipe limit has been reached. Load an existing recipe; no new copy will be created.");
  const recipes = modes.map(mode => safeRecipe(mode, ctx)).filter(Boolean);
  if (recipes.some(r => !r.readyForSchedule)) warnings.push("Some recipes need a narrower genre selection or currently approved music before scheduling.");
  return { stationId: P.stationId, draftOnly: true, recipes, genres: ctx.genres, limits: L, warnings };
}
export async function subscriberLibrary(db, options) { return libraryDto(db, await scope(db, options)); }

export async function subscriberCatalogue(db, { query = {}, ...options }) {
  const ctx = await scope(db, options);
  if (Object.keys(query).some(key => !["q", "genre", "limit", "offset"].includes(key)) ||
    (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 100)) ||
    (query.genre !== undefined && query.genre !== "" && (typeof query.genre !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(query.genre))))
    throw subscriberError("SUBSCRIBER_QUERY_INVALID");
  const limit = query.limit === undefined ? 50 : Number(query.limit), offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 2000)
    throw subscriberError("SUBSCRIBER_QUERY_INVALID");
  const q = (query.q || "").trim().toLowerCase(), genre = normaliseGenreCode(query.genre || "");
  const selected = ctx.entries.filter(e => (!genre || e.genreCodes.includes(genre)) && (!q ||
    [e.track.title, e.track.artist, e.track.album, e.track.mixName].some(value => String(value || "").toLowerCase().includes(q))))
    .sort((a, b) => String(a.track.title || "").localeCompare(String(b.track.title || "")) || a.track.id.localeCompare(b.track.id));
  return { stationId: P.stationId, stationName: ctx.workspace.stationName, metadataOnly: true, territory: P.territory,
    catalogueLevel: P.catalogueLevel, limit, offset, total: selected.length, genres: ctx.genres, warnings: [],
    tracks: selected.slice(offset, offset + limit).map(({ track, durationSeconds, genreCodes }) => ({ id: track.id,
      title: safeText(track.title, "Untitled"), artist: safeText(track.artist, "Unknown artist"), album: safeText(track.album), mix: safeText(track.mixName),
      durationSeconds, bpm: Number.isFinite(track.bpm) ? track.bpm : null, genreCodes, explicit: track.isExplicit === true,
      source: track.mediaAsset.licensedCatalogue ? "Licensed catalogue" : "Ruvanas catalogue" })) };
}
export async function subscriberPreviewRecipe(db, { input, ...options }) {
  const ctx = await scope(db, options), recipe = parseTestRadioRecipe(input), entries = pool(ctx, recipe);
  if (input.seed !== undefined && (typeof input.seed !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.seed))) throw subscriberError("LIBRARY_RECIPE_INVALID");
  const seed = input.seed || randomUUID(), generated = buildGenreRotation({ entries, ...recipe, seed });
  const items = generated.entries.slice(0, L.maximumPreviewItems).map((entry, position) => ({ position, trackId: entry.track.id,
    title: safeText(entry.track.title, "Untitled"), artist: safeText(entry.track.artist, "Unknown artist"), durationSeconds: entry.durationSeconds, genreCodes: entry.genreCodes }));
  const totalDurationSeconds = items.reduce((n, entry) => n + entry.durationSeconds, 0), requestedDurationSeconds = recipe.durationMinutes * 60;
  const truncated = generated.entries.length > items.length || totalDurationSeconds < requestedDurationSeconds;
  return { stationId: P.stationId, preview: { seed, items, totalDurationSeconds, requestedDurationSeconds, truncated, liveOrderFixed: false,
    warnings: [...generated.warnings, "Example order only. This metadata preview does not play audio or change broadcasting; the worker chooses its live order separately.",
      "Catalogue durations are rounded. An approved programme cuts its final song at its scheduled end and returns to AutoDJ.",
      ...(truncated ? ["The preview is limited to 200 rows; the saved recipe is a reusable genre template, not this fixed order."] : [])] } };
}
function requestAuditId(kind, input, ctx) {
  if (typeof input.requestId !== "string" || !UUID.test(input.requestId)) throw subscriberError("SUBSCRIBER_REQUEST_ID_REQUIRED");
  return `test-radio-subscriber-${kind}-${scheduleHash([P.stationId, ctx.actorId, input.requestId.toLowerCase()]).slice(0, 40)}`;
}
function retryMatches(previous, ctx, hash, action) {
  if (previous.action !== action || previous.organisationId !== ctx.organisationId || previous.actorUserId !== ctx.actorId ||
    previous.details?.stationId !== P.stationId || previous.details?.requestHash !== hash) throw subscriberError("SUBSCRIBER_RETRY_CHANGED");
}
export async function subscriberCreateRecipe(db, { input, now = new Date(), ...options }) {
  const recipe = parseTestRadioRecipe(input);
  const savedSourceId = await runSerializableTransaction(db, async tx => {
    const ctx = await scope(tx, { ...options, now }), id = requestAuditId("recipe", input, ctx);
    const hash = scheduleHash([ctx.organisationId, recipe]), previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) {
      retryMatches(previous, ctx, hash, "TEST_RADIO_SUBSCRIBER_RECIPE_CREATED");
      const mode = await tx.musicMode.findFirst({ where: { id: previous.details.sourceId, ...recipeWhere(ctx.organisationId) }, include: { smartPlaylist: true } });
      if (!safeRecipe(mode, ctx) || mode.smartPlaylist.id !== previous.entityId) throw subscriberError("LIBRARY_SAVED_RECIPE_UNAVAILABLE");
      return mode.id;
    }
    pool(ctx, recipe);
    if (await tx.musicMode.count({ where: recipeWhere(ctx.organisationId) }) >= L.maximumRecipes) throw subscriberError("LIBRARY_RECIPE_LIMIT");
    let slug; try { slug = smartPlaylistSlug(recipe.name); } catch { slug = "music-template"; }
    const mode = await tx.musicMode.create({ data: { organisationId: ctx.organisationId, name: recipe.name,
      slug: `test-radio-${slug}-${randomUUID().slice(0, 8)}`, source: "SMART_PLAYLIST", status: "DRAFT",
      description: "Subscriber Test Radio recipe draft. An administrator must separately approve on-air use." } });
    const playlist = await tx.smartPlaylist.create({ data: { organisationId: ctx.organisationId, musicModeId: mode.id,
      createdByUserId: ctx.actorId, status: "DRAFT", rightsUse: "ONLINE_RADIO", territory: P.territory,
      simpleBuildMode: recipe.buildMode, genreCodes: recipe.genreCodes, durationMinutes: recipe.durationMinutes } });
    await tx.auditLog.create({ data: { id, organisationId: ctx.organisationId, actorUserId: ctx.actorId,
      action: "TEST_RADIO_SUBSCRIBER_RECIPE_CREATED", entityType: "SmartPlaylist", entityId: playlist.id, createdAt: now,
      details: { stationId: P.stationId, sourceId: mode.id, requestHash: hash } } });
    return mode.id;
  });
  return { ...await subscriberLibrary(db, { ...options, now }), savedSourceId };
}

async function scheduleContext(db, options) {
  const ctx = await scope(db, options), channelId = options.channelId || ctx.workspace.channelId;
  if (channelId && !ctx.workspace.channels.some(c => c.id === channelId)) throw subscriberError("SCHEDULE_CHANNEL_INVALID");
  const modes = await modesFor(db, ctx);
  if (modes.length > S.maximumSources) throw subscriberError("SCHEDULE_SOURCE_LIMIT");
  const sources = modes.filter(mode => mode.organisationId === ctx.organisationId).map(mode => {
    const source = simpleScheduleSource(mode), recipe = safeRecipe(mode, ctx);
    return source && recipe ? { ...source, eligibleTrackCount: recipe.eligibleTrackCount,
      eligibleDurationSeconds: recipe.eligibleDurationSeconds, unavailableGenreCodes: recipe.unavailableGenreCodes,
      readyForSchedule: recipe.readyForSchedule } : null;
  }).filter(Boolean);
  const schedule = channelId ? await db.programmeSchedule.findFirst({ where: { organisationId: ctx.organisationId, channelId },
    include: { versions: { orderBy: { version: "desc" }, take: 1, include: versionInclude } } }) : null;
  if (schedule && (schedule.organisationId !== ctx.organisationId || schedule.channelId !== channelId)) throw subscriberError("SUBSCRIBER_ACCESS_DENIED");
  return { ...ctx, channelId, sources, schedule };
}
export async function subscriberSchedule(db, { now: suppliedNow, env = process.env, clock = () => new Date(), ...options }) {
  const now = suppliedNow || clock();
  const ctx = await scheduleContext(db, { ...options, now, env }), warnings = [];
  let draft = null;
  const version = ctx.schedule?.versions?.[0];
  if (version) {
    let preview = null;
    try {
      const parsed = parseContinuousSchedule({ channelId: ctx.channelId, name: ctx.schedule.name, timezone: ctx.schedule.timezone, items: scheduleFormItems(version.items) });
      const compiled = compileContinuousSchedule({ items: parsed.items.map((item, i) => ({ ...item, id: version.items[i].id })) },
        { timezone: ctx.schedule.timezone, startsAt: now, days: 7 });
      preview = { timezone: compiled.timezone, startsAt: compiled.startsAt.toISOString(), endsAt: compiled.endsAt.toISOString(), days: compiled.days,
        occurrences: compiled.occurrences.map(item => ({ label: item.label, startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), sourceId: item.sourceId, priority: item.priority })), warnings: compiled.warnings };
      buildContinuousScheduleSnapshot({ stationId: P.stationId, organisationId: ctx.organisationId, channelId: ctx.channelId,
        schedule: ctx.schedule, version, sources: ctx.sources, authorizedTracks: ctx.authorized.tracks });
      warnings.push(...compiled.warnings);
    } catch (error) { warnings.push(scheduleMessage(error.code)); }
    draft = { id: version.id, version: version.version, items: scheduleFormItems(version.items), reviewHash: null, readyToApprove: false, preview };
  }
  const runtime = await loadAuthorizedContinuousSchedule(db, { authorized: ctx.authorized, now, env });
  const approvedVersion = runtime.enabled ? await db.programmeScheduleVersion.findFirst({ where: { id: runtime.versionId,
    organisationId: ctx.organisationId, schedule: { organisationId: ctx.organisationId, channelId: runtime.channelId } }, select: { version: true } }) : null;
  const approved = runtime.enabled && Number.isInteger(approvedVersion?.version) ? { enabled: true, versionId: runtime.versionId, version: approvedVersion.version, channelId: runtime.channelId,
    timezone: runtime.timezone, effectiveAt: runtime.effectiveAt } : null;
  if (!ctx.workspace.channels.length) warnings.push("Ask your administrator to prepare Test Radio's Online Radio channel. No new channel is created here.");
  if (ctx.workspace.channels.length > 1 && !ctx.channelId) warnings.push("Choose the Test Radio channel before editing its week.");
  warnings.push("Saving creates a private draft only. Your administrator must review and approve it separately before it can change the live schedule.");
  // Read-only presentation: never impersonate the administrator or expose a
  // listener URL, source credentials, signed grant, or worker controls.
  const observation = (await db.auditLog.findUnique({ where: { id: CONTINUOUS_OBSERVATION_ID } }))?.details;
  const nowNext = buildTestRadioNowNext({ authorized: ctx.authorized, observation, runtime, now: suppliedNow || clock() });
  return { stationId: P.stationId, channels: ctx.workspace.channels, sources: ctx.sources,
    schedule: ctx.schedule ? { id: ctx.schedule.id, name: ctx.schedule.name, timezone: ctx.schedule.timezone, channelId: ctx.channelId } : null,
    draft, approved, nowNext, canEdit: Boolean(ctx.channelId), canApprove: false, draftOnly: true, warnings: [...new Set(warnings)] };
}
export async function subscriberSaveSchedule(db, { input, now = new Date(), ...options }) {
  const parsed = parseContinuousSchedule(input);
  if (input.baseVersionId !== null && (typeof input.baseVersionId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/.test(input.baseVersionId)))
    throw subscriberError("SUBSCRIBER_BASE_VERSION_REQUIRED");
  const savedVersionId = await runSerializableTransaction(db, async tx => {
    const ctx = await scheduleContext(tx, { ...options, now, channelId: parsed.channelId }), id = requestAuditId("week", input, ctx);
    const hash = scheduleHash([ctx.organisationId, parsed, input.baseVersionId]);
    const previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) {
      retryMatches(previous, ctx, hash, "TEST_RADIO_SUBSCRIBER_WEEKLY_DRAFT");
      if (ctx.schedule?.versions?.[0]?.id !== previous.entityId) throw subscriberError("SUBSCRIBER_DRAFT_CHANGED");
      const saved = await tx.programmeScheduleVersion.findFirst({ where: { id: previous.entityId, organisationId: ctx.organisationId,
        scheduleId: ctx.schedule?.id, schedule: { organisationId: ctx.organisationId, channelId: parsed.channelId } }, select: { id: true } });
      if (!saved) throw subscriberError("SUBSCRIBER_SAVED_DRAFT_UNAVAILABLE");
      return saved.id;
    }
    if ((ctx.schedule?.versions?.[0]?.id || null) !== input.baseVersionId) throw subscriberError("SUBSCRIBER_DRAFT_CHANGED");
    if (parsed.items.some(item => !ctx.sources.some(source => source.id === item.musicModeId))) throw subscriberError("SCHEDULE_SOURCE_UNAVAILABLE");
    const highest = ctx.schedule?.versions?.[0]?.version || 0;
    if (highest >= S.maximumVersions) throw subscriberError("SCHEDULE_VERSION_LIMIT");
    if (ctx.schedule && ctx.schedule.timezone !== parsed.timezone) throw subscriberError("SCHEDULE_TIMEZONE_IMMUTABLE");
    let schedule = ctx.schedule;
    if (!schedule) schedule = await tx.programmeSchedule.create({ data: { organisationId: ctx.organisationId, channelId: parsed.channelId,
      name: parsed.name, timezone: parsed.timezone, createdByUserId: ctx.actorId } });
    else await tx.programmeSchedule.update({ where: { id: schedule.id }, data: { name: parsed.name } });
    // Append, never update/activate/archive any previously approved version.
    const version = await tx.programmeScheduleVersion.create({ data: { organisationId: ctx.organisationId, scheduleId: schedule.id,
      version: highest + 1, status: "DRAFT", isActive: false, createdByUserId: ctx.actorId, items: { create: parsed.items } } });
    await tx.auditLog.create({ data: { id, organisationId: ctx.organisationId, actorUserId: ctx.actorId,
      action: "TEST_RADIO_SUBSCRIBER_WEEKLY_DRAFT", entityType: "ProgrammeScheduleVersion", entityId: version.id, createdAt: now,
      details: { stationId: P.stationId, channelId: parsed.channelId, scheduleId: schedule.id, requestHash: hash } } });
    return version.id;
  });
  return { ...await subscriberSchedule(db, { ...options, channelId: parsed.channelId, now }), savedVersionId };
}
export function subscriberMessage(code) {
  const labels = {
    SUBSCRIBER_ACCESS_DENIED: "Sign in with Test Radio's current authorised subscriber account.",
    SUBSCRIBER_QUERY_INVALID: "Use a shorter search or a valid catalogue page.",
    SUBSCRIBER_REQUEST_ID_REQUIRED: "Refresh these controls before saving a new draft.",
    SUBSCRIBER_BASE_VERSION_REQUIRED: "Load the latest saved week before editing.",
    SUBSCRIBER_DRAFT_CHANGED: "The saved week changed in another window. Reload it before saving your changes.",
    SUBSCRIBER_RETRY_CHANGED: "The earlier save used different settings. Refresh before saving a changed draft.",
    SUBSCRIBER_SAVED_DRAFT_UNAVAILABLE: "The earlier draft was saved but is no longer available. Refresh before retrying.",
  };
  return labels[code] || (code?.startsWith("SCHEDULE_") ? scheduleMessage(code) : code?.startsWith("LIBRARY_") || code?.startsWith("CONTINUOUS_")
    ? testRadioLibraryMessage(code) : "The request could not be confirmed. Retry unchanged to recover the same save; the live stream was not changed.");
}
