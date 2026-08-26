export function makeLocationGroupSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeLocationIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean))];
}

export function findLocationsOutsideOrganisation(locationIds, locations) {
  const foundIds = new Set(locations.map((location) => location.id));
  return locationIds.filter((id) => !foundIds.has(id));
}

