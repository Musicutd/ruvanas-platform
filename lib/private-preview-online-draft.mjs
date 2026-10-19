import { isPreviewOnlineDraftAccessMode, previewTesterAccessMode } from "./private-preview-account-policy.mjs";

export const ONLINE_DRAFT_LIMITS = Object.freeze({ playlists: 20, scheduleVersions: 20 });

export function onlineDraftSubscription(subscription) {
  return isPreviewOnlineDraftAccessMode(previewTesterAccessMode(subscription?.plan));
}

export function onlineDraftChannelWhere(organisationId) {
  return { organisationId, status: "DRAFT", musicRightsUse: "ONLINE_RADIO",
    station: { organisationId, productFamily: "ONLINE", status: "PENDING_SETUP",
      publicPlayerEnabled: false, stationWebsiteEnabled: false, streamConfig: null } };
}

// Configuration-only sources. No materialisation, track fetch or audio import.
export function onlineDraftMusicModeWhere(organisationId) {
  return { organisationId, status: "DRAFT", source: "SMART_PLAYLIST", smartPlaylist: {
    organisationId, status: "DRAFT", rightsUse: "ONLINE_RADIO", simpleBuildMode: { not: null }
  } };
}

export async function lockOnlineDraftOrganisation(tx, organisationId) {
  // Same-tenant metadata operations share this row lock so caps cannot be
  // exceeded by parallel Create/Duplicate/Save requests.
  const rows = await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
  if (rows.length !== 1) throw Object.assign(new Error("Test workspace unavailable."), { code: "DRAFT_WORKSPACE_UNAVAILABLE" });
}
