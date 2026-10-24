import { retailStreamStationSlug } from "./retail-stream-setup-service.mjs";

export const RETAIL_STREAM_DRAFT_PROTECTED_MESSAGE =
  "This managed Retail connection is a private draft. Use Retail connection setup; activation, probing and generic streaming changes are unavailable.";

const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);

// This deliberately identifies only the new, deterministic Retail draft
// identity. Existing Retail and other stations keep their established paths.
// Status is not part of the identity: a mistaken status change must not remove
// the lifecycle fence.
export function isManagedRetailStreamDraftStation(station) {
  return Boolean(station && validId(station.id) && validId(station.organisationId) &&
    station.productFamily === "RETAIL" && station.slug === retailStreamStationSlug(station.organisationId));
}
