export const ORGANISATION_TEMPLATES = Object.freeze({
  NGO_CHARITY: Object.freeze({ label: "NGO or charity", branchLabel: "Branch", audienceLabel: "Community" }),
  SPORTS_CLUB: Object.freeze({ label: "Sports club", branchLabel: "Club location", audienceLabel: "Supporters" }),
  ASSOCIATION: Object.freeze({ label: "Association", branchLabel: "Chapter", audienceLabel: "Members and community" }),
  COMMUNITY_CULTURAL: Object.freeze({ label: "Community or cultural organisation", branchLabel: "Venue", audienceLabel: "Community" }),
  POLITICAL_CIVIC: Object.freeze({ label: "Political or civic organisation", branchLabel: "Local branch", audienceLabel: "Public audience" }),
  FEDERATION_NETWORK: Object.freeze({ label: "Federation or network", branchLabel: "Member branch", audienceLabel: "Network audience" }),
  GENERAL: Object.freeze({ label: "General organisation", branchLabel: "Location", audienceLabel: "Audience" })
});

export const ORGANISATION_ANNOUNCEMENT_SURFACES = Object.freeze([
  "RADIO",
  "PODCAST",
  "DISPLAY",
  "WEB_PLAYER",
  "MOBILE_PLAYER"
]);

export const ORGANISATION_EVENT_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["READY", "CANCELLED"]),
  READY: Object.freeze(["LIVE", "CANCELLED"]),
  LIVE: Object.freeze(["ENDED"]),
  ENDED: Object.freeze([]),
  CANCELLED: Object.freeze([])
});

export const ORGANISATIONS_PRODUCT = Object.freeze({
  key: "ORGANISATIONS",
  capability: "organisationsEnabled",
  stationProductFamily: "ORGANISATIONS",
  podcastProduct: "ORGANISATIONS_RADIO",
  liveStudioProduct: "ORGANISATIONS_RADIO",
  musicRightsUse: "ORGANISATIONS_RADIO",
  autoDjTargetType: "ORGANISATIONS_CHANNEL",
  dashboardHref: "/dashboard/organisations"
});

export function organisationTemplate(value) {
  const key = String(value || "GENERAL").trim().toUpperCase();
  return Object.hasOwn(ORGANISATION_TEMPLATES, key) ? key : "GENERAL";
}

export function organisationTerminology(value) {
  return ORGANISATION_TEMPLATES[organisationTemplate(value)];
}

export function validateAnnouncementSurfaces(surfaces) {
  const selected = [...new Set((Array.isArray(surfaces) ? surfaces : []).map((surface) => String(surface).trim().toUpperCase()))];
  if (!selected.length) throw new Error("Choose at least one publication surface.");
  if (selected.some((surface) => !ORGANISATION_ANNOUNCEMENT_SURFACES.includes(surface))) {
    throw new Error("Choose only supported publication surfaces.");
  }
  return selected;
}

export function canTransitionOrganisationEvent(from, to) {
  return Boolean(ORGANISATION_EVENT_TRANSITIONS[from]?.includes(to));
}

export function validateOrganisationEventWindow({ startsAt, endsAt }) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error("Event end must be after its start.");
  }
  return { startsAt: start, endsAt: end };
}

export function organisationNetworkControlsEnabled(entitlements = {}) {
  return Boolean(entitlements.organisationsEnabled && Number(entitlements.planTierNumber || 0) >= 4);
}
