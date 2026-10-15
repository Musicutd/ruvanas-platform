import { SUBSCRIBER_PRODUCT_LIST } from "./product-access.mjs";

const PILLARS = new Set(SUBSCRIBER_PRODUCT_LIST.map(({ key }) => key));
const ORDINARY_AUDIO_PILLARS = ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"];
const PHYSICAL_PILLARS = ["RETAIL", "SCHOOL", "HEALTH", "FAITH", "ORGANISATIONS"];
const PODCAST_PILLARS = ["ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"];
const READ_METHODS = new Set(["GET", "HEAD"]);
const AUTH_METHODS = new Set(["PREVIEW_PASSWORD", "PREVIEW_CODE"]);
const ID = "[A-Za-z0-9_-]{1,191}";

// This is an additional preview boundary, not a replacement for downstream
// product, tenant, resource and rights checks. Initial tester access is a
// read-only sandbox: even the sandbox's OWNER membership cannot mutate data,
// create accounts, publish, obtain media or trigger processing through here.
const SHARED_PAGES = new Set([
  "/preview-dashboard", "/dashboard", "/dashboard/help", "/dashboard/how-it-works",
  "/dashboard/profile", "/dashboard/notifications", "/dashboard/support"
]);
const AUDIO_PAGES = new Set([
  "/dashboard/media", "/dashboard/programming", "/dashboard/studio",
  "/dashboard/player-sessions"
]);
const SHARED_READ_APIS = new Set([
  "/api/me", "/api/me/security", "/api/notifications", "/api/notifications/preferences",
  "/api/support/requests"
]);
const AUDIO_READ_APIS = new Set([
  "/api/programming", "/api/programming/simple", "/api/programming/smart-playlists",
  "/api/programming/radio-clocks", "/api/programming/advanced-scheduler",
  "/api/programming/voice-tracking",
  "/api/programming/audio-processing", "/api/studio/library", "/api/studio/credits",
  "/api/studio/orders", "/api/media/library", "/api/media/music", "/api/player-sessions",
  "/api/school-radio/audio-lab", "/api/school-radio/multitrack",
  "/api/reports/campaign-proof", "/api/reports/combined-delivery"
]);
const SCHOOL_READ_APIS = new Set([
  "/api/school-radio/announcements", "/api/school-radio/broadcast-slots",
  "/api/school-radio/editorial", "/api/school-radio/learning", "/api/school-radio/noticeboard",
  "/api/school-radio/show-builder", "/api/school-radio/newsroom",
  "/api/school-radio/pilot-readiness", "/api/school-radio/pilot-operations",
  "/api/school-radio/safeguarding-readiness", "/api/school-radio/retention-holds"
]);
const CORRECTIONS_READ_APIS = new Set([
  "/api/corrections/facilities", "/api/corrections/policy", "/api/corrections/contributors",
  "/api/corrections/development/modules", "/api/corrections/programmes",
  "/api/corrections/rehabilitation", "/api/corrections/requests", "/api/corrections/announcements",
  "/api/corrections/studio-sessions", "/api/corrections/overrides", "/api/corrections/network",
  "/api/corrections/network/report", "/api/corrections/network/windows",
  "/api/corrections/network/grants", "/api/corrections/network/distribution",
  "/api/corrections/network/audio-distribution", "/api/corrections/network/syndication"
]);

const PILLAR_PAGE_PATTERNS = [
  ["RETAIL", /^\/dashboard\/retail(?:\/music)?$/],
  ["SCHOOL", /^\/dashboard\/(?:school|school-radio)$/],
  ["ONLINE", new RegExp(`^/dashboard/radio(?:/(?:listen|schedule/${ID}|newsroom|rights-reporting|advertising))?$`)],
  ["ONLINE", new RegExp(`^/stations(?:/new|/${ID})?$`)],
  ["HEALTH", /^\/dashboard\/health(?:\/setup)?$/],
  ["FAITH", /^\/dashboard\/faith(?:\/setup)?$/],
  ["ORGANISATIONS", /^\/dashboard\/organisations(?:\/setup|\/workspace)?$/],
  ["CORRECTIONS", /^\/dashboard\/corrections(?:\/(?:announcements|contributors|programmes|rehabilitation|requests|studio|network))?$/]
];
const CORRECTIONS_READ_RESOURCE_PATTERNS = [
  new RegExp(`^/api/corrections/facilities/${ID}(?:/requests-policy|/staff)?$`),
  new RegExp(`^/api/corrections/contributors/${ID}(?:/development)?$`),
  new RegExp(`^/api/corrections/programmes/${ID}(?:/readiness|/rehabilitation)?$`),
  new RegExp(`^/api/corrections/rehabilitation/${ID}$`),
  new RegExp(`^/api/corrections/requests/${ID}$`),
  new RegExp(`^/api/corrections/studio-sessions/${ID}$`)
];

function canonicalPath(pathname) {
  // Next provides pathname separately from query parameters. Never decode a
  // second time or accept alternate separators/encoded/traversal spellings.
  return typeof pathname === "string" && pathname.length > 0 && pathname.length <= 2048 &&
    /^\/[A-Za-z0-9/_-]*$/.test(pathname) && !pathname.includes("//") &&
    (pathname === "/" || !pathname.endsWith("/"));
}

function testerPillars(session, now) {
  const user = session?.user;
  const access = user?.privatePreviewAccess;
  if (!user || user.role !== "OWNER" || !AUTH_METHODS.has(session.authMethod) || session.revokedAt ||
    !access || access.enabled !== true || typeof user.id !== "string" || !user.id ||
    access.userId !== user.id || typeof access.organisationId !== "string" || !access.organisationId ||
    access.organisationId !== session.activeOrganisationId ||
    !(access.expiresAt instanceof Date) || !Number.isFinite(access.expiresAt.getTime()) ||
    !(now instanceof Date) || !Number.isFinite(now.getTime()) || access.expiresAt <= now ||
    (session.authMethod === "PREVIEW_PASSWORD" && access.passwordEnabled !== true) ||
    !Array.isArray(access.pillars) || access.pillars.length < 1 || access.pillars.length > PILLARS.size ||
    access.pillars.some((pillar) => !PILLARS.has(pillar)) ||
    new Set(access.pillars).size !== access.pillars.length) return null;
  return new Set(access.pillars);
}

export function privatePreviewTesterRequestAllowed({ session, pathname, method, now = new Date() } = {}) {
  if (!canonicalPath(pathname)) return false;
  const pillars = testerPillars(session, now);
  if (!pillars) return false;
  if (method === "POST" && pathname === "/api/auth/logout") return true;
  if (!READ_METHODS.has(method)) return false;

  const hasAny = (values) => values.some((value) => pillars.has(value));
  if (SHARED_PAGES.has(pathname) || SHARED_READ_APIS.has(pathname)) return true;
  for (const [pillar, pattern] of PILLAR_PAGE_PATTERNS) {
    if (pattern.test(pathname)) return pillars.has(pillar);
  }
  const productPage = pathname.match(/^\/dashboard\/(?:autodj|listen)\/(retail|school|online|health|faith|organisations)$/);
  if (productPage) return pillars.has(productPage[1].toUpperCase());
  if (AUDIO_PAGES.has(pathname) || AUDIO_READ_APIS.has(pathname)) return hasAny(ORDINARY_AUDIO_PILLARS);
  if (["/dashboard/locations", "/dashboard/players", "/api/locations", "/api/player-setup"].includes(pathname)) {
    return hasAny(PHYSICAL_PILLARS);
  }
  if (["/dashboard/podcasts", "/api/podcasts", "/dashboard/listener-analytics", "/api/listener-analytics"].includes(pathname)) {
    return hasAny(PODCAST_PILLARS);
  }
  if (["/dashboard/promotions", "/api/promotions"].includes(pathname)) return hasAny(["RETAIL", "ONLINE"]);
  if (pathname === "/api/product-channels") return hasAny(["HEALTH", "FAITH", "ORGANISATIONS"]);
  if (pathname === "/api/organisations/workspace") return pillars.has("ORGANISATIONS");
  if (["/api/newsroom", "/api/radio-advertising", "/api/rights-royalty"].includes(pathname)) return pillars.has("ONLINE");
  if (SCHOOL_READ_APIS.has(pathname)) return pillars.has("SCHOOL");
  if (CORRECTIONS_READ_APIS.has(pathname) || CORRECTIONS_READ_RESOURCE_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return pillars.has("CORRECTIONS");
  }
  // No broad API prefixes. In particular a GET can create a supplier queue,
  // mint a token, download media or generate an export. Unknown endpoints,
  // static assets and future features require separate explicit review.
  return false;
}
