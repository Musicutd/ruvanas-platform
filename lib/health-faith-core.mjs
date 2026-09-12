export const HEALTH_FAITH_PRODUCTS = Object.freeze({
  HEALTH: Object.freeze({
    key: "HEALTH", label: "Ruvanas Health", capability: "healthRadioEnabled",
    rightsUse: "HEALTH_RADIO", targetType: "HEALTH_CHANNEL", route: "/dashboard/health",
    siteLabel: "hospital or health site", areaLabel: "ward, department or wellbeing area"
  }),
  FAITH: Object.freeze({
    key: "FAITH", label: "Ruvanas Faith", capability: "faithRadioEnabled",
    rightsUse: "FAITH_RADIO", targetType: "FAITH_CHANNEL", route: "/dashboard/faith",
    siteLabel: "campus or ministry site", areaLabel: "hall, foyer, room or community area"
  }),
  ORGANISATIONS: Object.freeze({
    key: "ORGANISATIONS", label: "Ruvanas Organisations", capability: "organisationsEnabled",
    rightsUse: "ORGANISATIONS_RADIO", targetType: "ORGANISATIONS_CHANNEL", route: "/dashboard/organisations",
    siteLabel: "branch, chapter or venue", areaLabel: "room, zone or event area"
  })
});

export function healthFaithProduct(value) {
  return HEALTH_FAITH_PRODUCTS[String(value || "").trim().toUpperCase()] || null;
}

export function normalizeAudiencePolicy(value, product) {
  const policy = String(value || "INTERNAL").trim().toUpperCase();
  if (!["INTERNAL", "RESTRICTED", "PUBLIC"].includes(policy)) throw new Error("Choose internal, restricted or public listening.");
  if (product === "HEALTH" && policy === "PUBLIC") return "PUBLIC";
  return policy;
}

export function normalizeHealthSongRequest(input = {}) {
  const trackQuery = String(input.trackQuery || "").trim().slice(0, 160);
  const displayName = String(input.displayName || "").trim().slice(0, 60) || null;
  if (trackQuery.length < 2) throw new Error("Enter a song or artist.");
  return Object.freeze({ trackQuery, displayName });
}

export function assertNoSensitiveHealthFields(input = {}) {
  const forbidden = ["patient", "medical", "diagnosis", "condition", "wardBed", "dateOfBirth", "nhs", "insurance"];
  const found = forbidden.find((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (found) throw new Error("Health song requests cannot collect clinical or patient-record information.");
  return true;
}

export function faithLiveServiceState({ startsAt, endsAt, now = new Date(), fallbackReady = false } = {}) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const instant = new Date(now);
  if ([start, end, instant].some((date) => Number.isNaN(date.getTime())) || end <= start) throw new Error("Choose a valid live-service window.");
  if (instant < start) return { state: "SCHEDULED", next: "LIVE_HANDOFF" };
  if (instant < end) return { state: "LIVE", next: fallbackReady ? "AUTODJ_RESUME" : "FALLBACK_REQUIRED" };
  return { state: "ENDED", next: fallbackReady ? "AUTODJ_RESUMED" : "FALLBACK_REQUIRED" };
}
