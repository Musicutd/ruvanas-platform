// Presentation helpers only. Server-side access, rights and output gates remain authoritative.
export function onlineRadioPlanningData(payload) {
  const channels = (payload?.channels || []).filter((channel) => channel.productFamily === "ONLINE");
  const ids = new Set(channels.map((channel) => channel.id));
  const draftOnly = payload?.sandboxDraftOnly === true;
  return {
    ...payload, channels,
    playlists: (payload?.playlists || []).filter((playlist) => playlist.rightsUse === "ONLINE_RADIO" && (!draftOnly || playlist.status === "DRAFT")),
    events: draftOnly ? [] : (payload?.events || []).filter((event) => ids.has(event.channelId))
  };
}

export function playlistFormSnapshot(playlist) {
  return JSON.stringify({ name: playlist.name, durationValue: String(playlist.durationValue), durationUnit: playlist.durationUnit,
    buildMode: playlist.buildMode, genreCodes: playlist.genreCodes });
}

export function playlistFormIssues(playlist, channel, requiredRightsUse = null) {
  const issues = [];
  if (!channel?.rightsUse) issues.push("Choose a channel with its music-rights setup completed.");
  else if (requiredRightsUse && channel.rightsUse !== requiredRightsUse) issues.push("This channel needs an Online Radio music-rights profile. Ask your administrator to check its setup.");
  if (playlist.name.trim().length < 2) issues.push("Give your playlist a name of at least two characters.");
  const length = Number(playlist.durationValue);
  if (!Number.isInteger(length) || length < 1 || length > 30) issues.push("Choose a whole-number length from 1 to 30.");
  if (!playlist.genreCodes.length) issues.push("Choose at least one music genre.");
  return issues;
}

export function filterSavedPlaylists(playlists, query) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  return (playlists || []).filter((playlist) => !needle || `${playlist.name} ${playlist.genreCodes.join(" ")}`.toLocaleLowerCase().includes(needle));
}

export function catalogueSearchPath({ channelId = "", query = "", genre = "" } = {}) {
  const params = new URLSearchParams({ product: "ONLINE", limit: "50" });
  if (channelId) params.set("channelId", channelId);
  if (query.trim()) params.set("q", query.trim().slice(0, 100));
  if (genre) params.set("genre", genre);
  return `/api/catalogue/music?${params}`;
}

export function musicDuration(seconds) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) return "Not supplied";
  return `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`;
}
