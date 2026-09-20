export const STUDIO_LIBRARY_TABS = Object.freeze([
  { id: "ALL", label: "All audio" },
  { id: "MUSIC", label: "Music" },
  { id: "JINGLE", label: "Jingles" },
  { id: "COMMERCIAL", label: "Adverts" },
  { id: "ANNOUNCEMENT", label: "Announcements" },
  { id: "VOICEOVER", label: "Voiceovers" }
]);

export function studioProgrammePackScope(organisationId, productFamily) {
  if (!organisationId || !productFamily) throw new Error("A Studio organisation and product are required.");
  return { organisationId, productFamily };
}

export function mergeStudioLibraryAssets(recentAssets, packAssets) {
  const merged = new Map();
  for (const asset of [...(recentAssets || []), ...(packAssets || [])]) {
    if (asset?.id && !merged.has(asset.id)) merged.set(asset.id, asset);
  }
  return [...merged.values()];
}

export function filterStudioLibraryAssets(assets, { tab = "ALL", query = "" } = {}) {
  const selectedTab = STUDIO_LIBRARY_TABS.some((item) => item.id === tab) ? tab : "ALL";
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (Array.isArray(assets) ? assets : []).filter((asset) => {
    if (selectedTab !== "ALL" && asset.mediaType !== selectedTab) return false;
    if (!terms.length) return true;
    const searchable = [asset.name, asset.title, asset.artist, asset.mediaType]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

export function studioPackItemAvailability(item, availableAssets) {
  const asset = (Array.isArray(availableAssets) ? availableAssets : []).find((candidate) => candidate.id === item.mediaAssetId);
  return { asset: asset || null, canPrepare: Boolean(asset) };
}
