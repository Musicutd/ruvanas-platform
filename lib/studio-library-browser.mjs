export const STUDIO_LIBRARY_PAGE_SIZE = 60;

export function studioLibraryGenreLabel(code) {
  const value = String(code || "").trim();
  if (/^r(?:-|_|\s)*(?:and|&)(?:-|_|\s)*b$/i.test(value)) return "R&B";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function studioLibraryCard({ track, genreCodes }) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album || null,
    mix: track.mixName || null,
    bpm: track.bpm || null,
    durationSeconds: track.mediaAsset?.durationSeconds || null,
    genres: Array.isArray(genreCodes) ? genreCodes.slice(0, 4) : [],
    explicit: Boolean(track.isExplicit),
    source: track.mediaAsset?.libraryType === "RUVANAS_CATALOGUE" ? "Ruvanas catalogue" : "Your music"
  };
}

export function filterStudioLibraryCards(cards, { query = "", genre = "" } = {}) {
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const selectedGenre = String(genre).trim().toLocaleLowerCase();
  return (Array.isArray(cards) ? cards : []).filter((card) => {
    if (selectedGenre && !(card.genres || []).some((item) => item.toLocaleLowerCase() === selectedGenre)) return false;
    const searchable = [card.title, card.artist, card.album, card.mix, ...(card.genres || [])].filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
