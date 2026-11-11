const searchKey = value => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();

export const catalogueRowCanUpdateTier = row => Boolean(row.track) && row.mediaType === "MUSIC" && !["ARCHIVED", "DELETED"].includes(row.status);

// Send only the fields used by the owner catalogue table to the client.
export function catalogueTableRows(assets) {
  return assets.map(asset => ({
    id: asset.id,
    title: asset.track?.title || asset.name || "Untitled track",
    artist: asset.track?.artist || "",
    originalName: asset.originalName || "",
    mixName: asset.track?.mixName || "",
    bpm: asset.track?.bpm || null,
    mediaType: asset.mediaType,
    status: asset.track?.status || asset.status,
    rightsHolder: asset.track?.rightsHolder || "",
    createdAt: asset.createdAt ? new Date(asset.createdAt).toISOString() : null,
    genres: (asset.genres || []).map(item => ({ id: item.mediaGenre.id, name: item.mediaGenre.name })),
    track: asset.track ? {
      id: asset.track.id,
      minimumCatalogueLevel: asset.track.minimumCatalogueLevel,
      catalogueAllTiers: asset.track.catalogueAllTiers === true,
      permittedUses: [...(asset.track.permittedUses || [])],
      permittedTerritories: asset.track.permittedTerritories || ""
    } : null
  }));
}

export function catalogueGenreOptions(rows) {
  return [...new Map(rows.flatMap(row => row.genres).map(genre => [genre.id, genre])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterCatalogueRows(rows, { query = "", scope = "all", genreId = "" } = {}) {
  const terms = searchKey(query).split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    if (genreId && !row.genres.some(genre => genre.id === genreId)) return false;
    const fields = scope === "title" ? [row.title]
      : scope === "artist" ? [row.artist]
      : [row.title, row.artist, ...row.genres.map(genre => genre.name)];
    const searchable = searchKey(fields.join(" "));
    return terms.every(term => searchable.includes(term));
  });
}
