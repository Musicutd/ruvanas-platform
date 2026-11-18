import { randomUUID, createHash } from "node:crypto";
import { catalogueTestOwnerSessionValid } from "./catalogue-test-service.mjs";
import { loadAuthorizedContinuousRadio } from "./test-radio-continuous-service.mjs";
import { TEST_RADIO_CONTINUOUS as P } from "./test-radio-continuous-policy.mjs";
import { simpleScheduleSource } from "./test-radio-continuous-schedule-policy.mjs";
import { buildGenreRotation } from "./subscriber-playlists.mjs";
import { genreCodesForTrack, licensedGenresForLevel, normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { smartPlaylistSlug } from "./smart-playlists.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export const TEST_RADIO_LIBRARY_LIMITS = Object.freeze({ maximumRecipes: 20, maximumRecipeTracks: 64, maximumPreviewItems: 200, maximumDurationMinutes: 180 });
const L = TEST_RADIO_LIBRARY_LIMITS;
const error = code => Object.assign(new Error(code), { code });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function requireOwner(actorSession, now) {
  if (!catalogueTestOwnerSessionValid(actorSession, actorSession?.userId, now)) throw error("LIBRARY_OWNER_REQUIRED");
}
function recipeWhere(organisationId) {
  return { organisationId, source: "SMART_PLAYLIST", status: { in: ["DRAFT", "ACTIVE"] }, smartPlaylist: {
    organisationId, status: { in: ["DRAFT", "ACTIVE"] }, rightsUse: "ONLINE_RADIO", simpleBuildMode: { in: ["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"] } } };
}
async function authorisedContext(db, options) {
  requireOwner(options.actorSession, options.now);
  const authorized = await loadAuthorizedContinuousRadio(db, { now: options.now, env: options.env });
  if (authorized.station.id !== P.stationId || authorized.grant.stationId !== P.stationId || authorized.station.organisationId !== authorized.grant.organisationId)
    throw error("LIBRARY_SCOPE_INVALID");
  const allowedGenres = new Map(licensedGenresForLevel(P.catalogueLevel, authorized.configuredGenres).map(genre => [genre.code, genre.label]));
  const entries = authorized.tracks.map(entry => ({ ...entry, genreCodes: genreCodesForTrack(entry.track).filter(code => allowedGenres.has(code)) }));
  const genres = [...allowedGenres].map(([code, name]) => ({ code, name, eligibleTrackCount: entries.filter(entry => entry.genreCodes.includes(code)).length }))
    .filter(genre => genre.eligibleTrackCount > 0).sort((a, b) => a.name.localeCompare(b.name));
  return { authorized, organisationId: authorized.station.organisationId, entries, genres };
}
export function parseTestRadioRecipe(input) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name) ||
    !["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"].includes(input?.buildMode) || !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1 || input.durationMinutes > L.maximumDurationMinutes || !Array.isArray(input.genreCodes) ||
    !input.genreCodes.length || input.genreCodes.length > 48 || input.genreCodes.some(code => typeof code !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(code)))
    throw error("LIBRARY_RECIPE_INVALID");
  const genreCodes = input.genreCodes.map(normaliseGenreCode);
  if (input.buildMode === "RANDOM_GENRE_POOL" && new Set(genreCodes).size !== genreCodes.length) throw error("LIBRARY_RECIPE_INVALID");
  return { name, buildMode: input.buildMode, genreCodes, durationMinutes: input.durationMinutes };
}
function selectedEntries(context, recipe) {
  if (recipe.genreCodes.some(code => !context.genres.some(genre => genre.code === code))) throw error("LIBRARY_GENRE_UNAVAILABLE");
  const selected = context.entries.filter(entry => entry.genreCodes.some(code => recipe.genreCodes.includes(code)));
  if (!selected.length) throw error("LIBRARY_NO_APPROVED_MUSIC");
  if (selected.length > L.maximumRecipeTracks) throw error("LIBRARY_RECIPE_TOO_LARGE");
  // Catalogue seconds are rounded; reserve one second per recording so this
  // admission estimate does not promise more timeline entries than the worker.
  const shortest = Math.max(.25, Math.min(...selected.map(entry => entry.durationSeconds)) - 1);
  if (Math.ceil(recipe.durationMinutes * 60 / shortest) > 3900) throw error("LIBRARY_PROGRAMME_TOO_DENSE");
  return selected;
}
function safeRecipe(mode, context) {
  const source = simpleScheduleSource(mode);
  if (!source || mode.organisationId !== context.organisationId) return null;
  const eligibleTrackCount = context.entries.filter(entry => entry.genreCodes.some(code => source.genreCodes.includes(code))).length;
  const allowed = source.genreCodes.every(code => context.genres.some(genre => genre.code === code));
  const selected = context.entries.filter(entry => entry.genreCodes.some(code => source.genreCodes.includes(code)));
  const duration = mode.smartPlaylist.durationMinutes || 60;
  const bounded = selected.length > 0 && Math.ceil(duration * 60 / Math.max(.25, Math.min(...selected.map(entry => entry.durationSeconds)) - 1)) <= 3900;
  return { sourceId: mode.id, playlistId: mode.smartPlaylist.id, name: source.name, version: mode.smartPlaylist.version,
    buildMode: source.buildMode, genreCodes: source.genreCodes, durationMinutes: mode.smartPlaylist.durationMinutes,
    eligibleTrackCount, readyForSchedule: allowed && bounded && eligibleTrackCount > 0 && eligibleTrackCount <= L.maximumRecipeTracks };
}
async function dashboardFromContext(db, context) {
  const modes = await db.musicMode.findMany({ where: recipeWhere(context.organisationId), include: { smartPlaylist: true }, orderBy: { name: "asc" }, take: L.maximumRecipes + 1 });
  const recipes = modes.map(mode => safeRecipe(mode, context)).filter(Boolean);
  const warnings = [];
  if (modes.length >= L.maximumRecipes) warnings.push("The 20-recipe limit has been reached. Existing recipes can still be loaded; no new copy will be created.");
  if (modes.length > L.maximumRecipes) warnings.push("More than 20 recipes already exist. The weekly planner needs a separate recipe-limit review before approving more sources.");
  if (recipes.some(recipe => !recipe.readyForSchedule)) warnings.push("Some saved recipes need a narrower genre selection or currently approved songs before they can be scheduled.");
  return { stationId: P.stationId, recipes, genres: context.genres, limits: L, warnings };
}
export async function testRadioPlannerLibrary(db, { actorSession, now = new Date(), env = process.env } = {}) {
  const context = await authorisedContext(db, { actorSession, now, env });
  return dashboardFromContext(db, context);
}
export async function previewTestRadioRecipe(db, { actorSession, input, now = new Date(), env = process.env } = {}) {
  const context = await authorisedContext(db, { actorSession, now, env });
  const recipe = parseTestRadioRecipe(input), entries = selectedEntries(context, recipe);
  if (input.seed !== undefined && (typeof input.seed !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.seed))) throw error("LIBRARY_RECIPE_INVALID");
  const seed = input.seed || randomUUID();
  const generated = buildGenreRotation({ entries, genreCodes: recipe.genreCodes, buildMode: recipe.buildMode, durationMinutes: recipe.durationMinutes, seed });
  const items = generated.entries.slice(0, L.maximumPreviewItems).map((entry, position) => ({ position, trackId: entry.track.id,
    title: String(entry.track.title || "Untitled").slice(0, 300), artist: String(entry.track.artist || "Unknown artist").slice(0, 300),
    durationSeconds: entry.durationSeconds, genreCodes: entry.genreCodes }));
  const totalDurationSeconds = items.reduce((seconds, item) => seconds + item.durationSeconds, 0);
  const requestedDurationSeconds = recipe.durationMinutes * 60, truncated = generated.entries.length > items.length || totalDurationSeconds < requestedDurationSeconds;
  const warnings = [...generated.warnings, "Example order only: this metadata preview does not play audio, save a playlist or change broadcasting. The worker chooses its live order separately."];
  warnings.push("Durations here use verified catalogue metadata, not a sample-accurate broadcast clock. A scheduled programme cuts its final song at the programme end and returns to AutoDJ.");
  if (truncated) warnings.push("This preview is limited to 200 rows. The saved recipe remains a reusable genre template, not this fixed track list.");
  return { stationId: P.stationId, preview: { seed, items, requestedDurationSeconds, totalDurationSeconds, truncated, warnings, liveOrderFixed: false } };
}
export async function createTestRadioRecipe(db, { actorSession, input, now = new Date(), env = process.env } = {}) {
  requireOwner(actorSession, now);
  const recipe = parseTestRadioRecipe(input);
  if (typeof input.requestId !== "string" || !uuid.test(input.requestId)) throw error("LIBRARY_REQUEST_ID_REQUIRED");
  const requestId = input.requestId.toLowerCase();
  const requestAuditId = `test-radio-recipe-${digest([P.stationId, actorSession.userId, requestId]).slice(0, 48)}`;
  const savedSourceId = await runSerializableTransaction(db, async tx => {
    const context = await authorisedContext(tx, { actorSession, now, env });
    const recipeHash = digest([P.stationId, context.organisationId, actorSession.userId, recipe]);
    const previous = await tx.auditLog.findUnique({ where: { id: requestAuditId } });
    if (previous) {
      if (previous.action !== "TEST_RADIO_RECIPE_CREATED" || previous.organisationId !== context.organisationId || previous.actorUserId !== actorSession.userId ||
        previous.details?.stationId !== P.stationId || previous.details?.recipeHash !== recipeHash) throw error("LIBRARY_RETRY_CHANGED");
      const mode = await tx.musicMode.findFirst({ where: { id: previous.details.sourceId, ...recipeWhere(context.organisationId) }, include: { smartPlaylist: true } });
      if (!safeRecipe(mode, context) || mode.smartPlaylist.id !== previous.entityId) throw error("LIBRARY_SAVED_RECIPE_UNAVAILABLE");
      return mode.id;
    }
    selectedEntries(context, recipe);
    if (await tx.musicMode.count({ where: recipeWhere(context.organisationId) }) >= L.maximumRecipes) throw error("LIBRARY_RECIPE_LIMIT");
    let nameSlug;
    try { nameSlug = smartPlaylistSlug(recipe.name); } catch { nameSlug = "music-template"; }
    const mode = await tx.musicMode.create({ data: { organisationId: context.organisationId, name: recipe.name,
      slug: `test-radio-${nameSlug}-${randomUUID().slice(0, 8)}`, source: "SMART_PLAYLIST", status: "DRAFT",
      description: "Reusable Test Radio genre recipe. Saving does not approve a schedule or change the live stream." } });
    // Separate creates use the actual unchecked Prisma inputs; no composite
    // relation keys are supplied inside an incompatible nested create.
    const playlist = await tx.smartPlaylist.create({ data: { organisationId: context.organisationId, musicModeId: mode.id,
      createdByUserId: actorSession.userId, status: "DRAFT", rightsUse: "ONLINE_RADIO", territory: P.territory,
      simpleBuildMode: recipe.buildMode, genreCodes: recipe.genreCodes, durationMinutes: recipe.durationMinutes } });
    await tx.auditLog.create({ data: { id: requestAuditId, organisationId: context.organisationId, actorUserId: actorSession.userId,
      action: "TEST_RADIO_RECIPE_CREATED", entityType: "SmartPlaylist", entityId: playlist.id, createdAt: now,
      details: { stationId: P.stationId, sourceId: mode.id, recipeHash, buildMode: recipe.buildMode, durationMinutes: recipe.durationMinutes } } });
    return mode.id;
  });
  return { ...await testRadioPlannerLibrary(db, { actorSession, now, env }), savedSourceId };
}
export function testRadioLibraryMessage(code) {
  const labels = {
    LIBRARY_RECIPE_INVALID: "Enter a name, 1–180 minutes and a valid random genre mix or ordered genre pattern.",
    LIBRARY_SCOPE_INVALID: "These playlist controls are available only for the existing Test Radio workspace.",
    LIBRARY_OWNER_REQUIRED: "Sign in with the current Super Admin owner session.",
    LIBRARY_GENRE_UNAVAILABLE: "Choose only genres with recordings that currently pass Test Radio's music-rights checks.",
    LIBRARY_NO_APPROVED_MUSIC: "No currently approved recordings match this recipe.",
    LIBRARY_RECIPE_TOO_LARGE: "This recipe matches more than 64 recordings. Choose fewer or narrower genres before generating or saving it.",
    LIBRARY_PROGRAMME_TOO_DENSE: "These very short recordings could exceed the worker's safe programme limit. Choose a shorter programme before generating or saving it.",
    LIBRARY_RECIPE_LIMIT: "This workspace already has 20 supported recipes. Load an existing recipe; no new copy was created.",
    LIBRARY_REQUEST_ID_REQUIRED: "Refresh the recipe controls before saving a new copy.",
    LIBRARY_RETRY_CHANGED: "This save identifier belongs to different settings. Refresh and save the changed recipe as a new request.",
    LIBRARY_SAVED_RECIPE_UNAVAILABLE: "The earlier save completed, but its recipe is no longer available. Refresh rather than creating a duplicate.",
    CONTINUOUS_NOT_ENABLED: "Test Radio needs its existing continuous AutoDJ owner approval before this catalogue can be used here.",
    CONTINUOUS_NO_APPROVED_MUSIC: "Test Radio needs at least two recordings passing its current music-rights checks.",
    CONTINUOUS_SERVICE_INACTIVE: "Test Radio's current service permission needs review. No playlist or streaming setting was changed.",
  };
  return labels[code] || "The recipe request could not be confirmed. Refresh before retrying; the live stream was not changed.";
}
