export const PLAYLIST_DESK_STATION_ID = "cmvcnbwi20008hr23sd76psi8";
export const emptyDeskRecipe = () => ({ name: "", buildMode: "RANDOM_GENRE_POOL", genreCodes: [], durationMinutes: 60 });
export function deskRecipeForm(recipe) {
  if (!recipe) return emptyDeskRecipe();
  return { name: recipe.name || "", buildMode: recipe.buildMode, genreCodes: [...(recipe.genreCodes || [])], durationMinutes: recipe.durationMinutes };
}
export function deskRecipeSnapshot(form) {
  return JSON.stringify({ name: form.name, buildMode: form.buildMode, genreCodes: form.genreCodes, durationMinutes: String(form.durationMinutes) });
}
export function deskRecipeIssues(form, genres) {
  const issues = [], minutes = Number(form.durationMinutes);
  if (typeof form.name !== "string" || form.name.trim().length < 2 || form.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(form.name)) issues.push("Give your playlist a name between 2 and 120 characters, without control characters.");
  if (!["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"].includes(form.buildMode)) issues.push("Choose Random Genre Mix or Genre Sequence.");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) issues.push("Choose a preview and new-playlist length from 1 to 180 minutes. Existing saved lengths are not changed.");
  if (!Array.isArray(form.genreCodes) || form.genreCodes.length < 1 || form.genreCodes.length > 48) issues.push("Choose 1 to 48 genre slots.");
  else {
    if (form.genreCodes.some(code => typeof code !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(code))) issues.push("Choose valid available genres.");
    if (genres && form.genreCodes.some(code => !genres.some(genre => genre.code === code))) issues.push("A selected genre is no longer available. Choose from the current library.");
    if (form.buildMode === "RANDOM_GENRE_POOL" && new Set(form.genreCodes).size !== form.genreCodes.length) issues.push("Choose each genre once for a random mix.");
  }
  return issues;
}
export function deskRecipeCommand(form, { action, requestId, genres } = {}) {
  const issues = deskRecipeIssues(form, genres);
  if (issues.length) throw new Error(issues[0]);
  const payload = { name: form.name.trim(), buildMode: form.buildMode, genreCodes: [...form.genreCodes], durationMinutes: Number(form.durationMinutes) };
  if (action === "preview") return { action, ...payload };
  if (action !== "save" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId || "")) throw new Error("Refresh before saving this new playlist.");
  return { action, requestId, ...payload };
}
export function deskLibrary(body) {
  const text = value => typeof value === "string" && value.length > 0 && value.length <= 500;
  const count = value => Number.isInteger(value) && value >= 0;
  const codes = values => Array.isArray(values) && values.length <= 48 && values.every(code => typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code));
  // The service returns one overflow recipe so an already-over-limit account
  // can show a warning without concealing its existing saved recipes.
  if (body?.stationId !== PLAYLIST_DESK_STATION_ID || !Array.isArray(body.recipes) || body.recipes.length > 21 ||
    !Array.isArray(body.genres) || body.genres.length > 500 || body.recipes.some(recipe =>
      !text(recipe.sourceId) || !text(recipe.name) || !["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"].includes(recipe.buildMode) ||
      !codes(recipe.genreCodes) || !Number.isInteger(recipe.durationMinutes) || recipe.durationMinutes < 1 ||
      !count(recipe.eligibleTrackCount) || typeof recipe.readyForSchedule !== "boolean" ||
      recipe.readyForSchedule && (recipe.eligibleTrackCount < 1 || recipe.eligibleTrackCount > 64)) ||
    body.genres.some(genre => !codes([genre.code]) || !text(genre.name) || !count(genre.eligibleTrackCount)) ||
    new Set(body.recipes.map(recipe => recipe.sourceId)).size !== body.recipes.length ||
    new Set(body.genres.map(genre => genre.code)).size !== body.genres.length) throw new Error("The saved Test Radio library could not be verified. Refresh the library.");
  return { stationId: body.stationId,
    recipes: body.recipes.map(recipe => ({ sourceId: recipe.sourceId, playlistId: recipe.playlistId, name: recipe.name,
      version: recipe.version, buildMode: recipe.buildMode, genreCodes: [...recipe.genreCodes], durationMinutes: recipe.durationMinutes,
      eligibleTrackCount: recipe.eligibleTrackCount, readyForSchedule: recipe.readyForSchedule,
      ...(Number.isFinite(recipe.eligibleDurationSeconds) && recipe.eligibleDurationSeconds >= 0 ? { eligibleDurationSeconds: recipe.eligibleDurationSeconds } : {}),
      ...(codes(recipe.unavailableGenreCodes) ? { unavailableGenreCodes: [...recipe.unavailableGenreCodes] } : {}) })),
    genres: body.genres.map(genre => ({ code: genre.code, name: genre.name, eligibleTrackCount: genre.eligibleTrackCount })),
    limits: { maximumRecipes: 20, maximumRecipeTracks: 64, maximumPreviewItems: 200, maximumDurationMinutes: 180 },
    warnings: Array.isArray(body.warnings) ? body.warnings.filter(value => typeof value === "string").slice(0, 20) : [] };
}
export function filterDeskRecipes(recipes, query) {
  const term = String(query || "").trim().toLowerCase();
  return (recipes || []).filter(recipe => !term || `${recipe.name} ${(recipe.genreCodes || []).join(" ")}`.toLowerCase().includes(term));
}
export function deskDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "—";
  const rounded = Math.round(Number(seconds)), minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}
export function deskPreview(body) {
  const p = body?.preview;
  if (body?.stationId !== PLAYLIST_DESK_STATION_ID || p?.liveOrderFixed !== false || !Array.isArray(p.items) || p.items.length > 200 ||
    !Number.isFinite(p.requestedDurationSeconds) || p.requestedDurationSeconds < 60 || p.requestedDurationSeconds > 10800 ||
    !Number.isFinite(p.totalDurationSeconds) || p.totalDurationSeconds < 0 || p.items.some(item =>
      !Number.isInteger(item.position) || item.position < 0 || item.position > 200 || typeof item.trackId !== "string" || !item.trackId || item.trackId.length > 500 || typeof item.title !== "string" || typeof item.artist !== "string" ||
      !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0 || item.durationSeconds > 3600)) throw new Error("The playlist preview could not be verified. Generate it again.");
  let elapsed = 0;
  return { requestedDurationSeconds: p.requestedDurationSeconds, totalDurationSeconds: p.totalDurationSeconds,
    truncated: p.truncated === true, warnings: Array.isArray(p.warnings) ? p.warnings.filter(value => typeof value === "string").slice(0, 20) : [],
    items: p.items.map((item, index) => { const startSeconds = elapsed; elapsed += item.durationSeconds; return {
      position: index + 1, trackId: item.trackId, title: item.title.slice(0, 240), artist: item.artist.slice(0, 240), durationSeconds: item.durationSeconds, startSeconds
    }; }) };
}
export function deskRecipeProgramme(recipe) {
  if (typeof recipe?.sourceId !== "string" || !recipe.sourceId || typeof recipe.name !== "string" || !recipe.name || recipe.readyForSchedule !== true || !Number.isInteger(recipe.durationMinutes) || recipe.durationMinutes < 1 || recipe.durationMinutes > 180) return null;
  return { label: recipe.name, recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId: recipe.sourceId, weekday: 1, startTime: "09:00", startsAt: "", durationMinutes: recipe.durationMinutes, priority: 50 };
}
// Refresh source choices without reloading or replacing the user's unsaved week.
export function mergeDeskRecipeSources(state, recipes) {
  if (state?.stationId !== PLAYLIST_DESK_STATION_ID) return state;
  const sources = new Map((state.sources || []).map(source => [source.id, source]));
  for (const recipe of recipes || []) if (recipe.sourceId) sources.set(recipe.sourceId, {
    ...sources.get(recipe.sourceId), id: recipe.sourceId, name: recipe.name, buildMode: recipe.buildMode, genreCodes: [...recipe.genreCodes],
    eligibleTrackCount: recipe.eligibleTrackCount, readyForSchedule: recipe.readyForSchedule,
    ...(Number.isFinite(recipe.eligibleDurationSeconds) ? { eligibleDurationSeconds: recipe.eligibleDurationSeconds } : {}),
    ...(Array.isArray(recipe.unavailableGenreCodes) ? { unavailableGenreCodes: [...recipe.unavailableGenreCodes] } : {})
  });
  return { ...state, sources: [...sources.values()] };
}
