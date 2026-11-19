import assert from "node:assert/strict";
import test from "node:test";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const ALL = ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS", "CORRECTIONS"];
function session(pillars = ["RETAIL"], authMethod = "PREVIEW_PASSWORD") {
  return {
    activeOrganisationId: "sandbox-org", authMethod, revokedAt: null,
    user: {
      id: "tester-user", role: "OWNER", email: "tester@example.test",
      privatePreviewAccess: {
        userId: "tester-user", organisationId: "sandbox-org", enabled: true, passwordEnabled: true,
        pillars, expiresAt: new Date("2026-10-16T12:00:00.000Z")
      }
    }
  };
}
function allowed(pathname, { pillars = ALL, method = "GET", actor = session(pillars) } = {}) {
  return privatePreviewTesterRequestAllowed({ session: actor, pathname, method, now: NOW });
}

test("enrolled OWNER is a non-platform-admin sandbox role; ordinary password and SSO never enter", () => {
  for (const authMethod of ["PREVIEW_PASSWORD", "PREVIEW_CODE"]) {
    assert.equal(allowed("/preview-dashboard", { actor: session(ALL, authMethod) }), true);
  }
  for (const authMethod of ["PASSWORD", "SSO", "PREVIEW_LOGIN_CODE", "", undefined]) {
    const actor = session(ALL); actor.authMethod = authMethod;
    assert.equal(allowed("/preview-dashboard", { actor }), false);
  }
  for (const role of ["SUPER_ADMIN", "SUPPORT", "MANAGER", "CONTENT_EDITOR", "VIEWER", "STUDENT", undefined]) {
    const actor = session(ALL); actor.user.role = role;
    assert.equal(allowed("/preview-dashboard", { actor }), false);
  }
});

test("operational aggregation GET and its dashboard entry are not read-only tester surfaces", () => {
  for (const path of ["/api/reports/operational", "/dashboard/analytics", "/dashboard/reports"]) {
    assert.equal(allowed(path), false);
  }
});

test("missing, disabled, expired or inconsistent tester enrollment fails closed", () => {
  const mutate = [
    (actor) => { delete actor.user; },
    (actor) => { delete actor.user.privatePreviewAccess; },
    (actor) => { actor.user.privatePreviewAccess.enabled = false; },
    (actor) => { actor.user.privatePreviewAccess.enabled = "true"; },
    (actor) => { actor.user.privatePreviewAccess.passwordEnabled = false; },
    (actor) => { actor.user.privatePreviewAccess.userId = "different-user"; },
    (actor) => { actor.user.privatePreviewAccess.organisationId = null; },
    (actor) => { actor.activeOrganisationId = "owner-org"; },
    (actor) => { actor.activeOrganisationId = null; },
    (actor) => { actor.revokedAt = NOW; },
    (actor) => { actor.user.privatePreviewAccess.expiresAt = null; },
    (actor) => { actor.user.privatePreviewAccess.expiresAt = "2026-10-16T12:00:00Z"; },
    (actor) => { actor.user.privatePreviewAccess.expiresAt = new Date("invalid"); },
    (actor) => { actor.user.privatePreviewAccess.expiresAt = NOW; },
    (actor) => { actor.user.privatePreviewAccess.expiresAt = new Date(NOW.getTime() - 1); }
  ];
  for (const change of mutate) {
    const actor = session(ALL); change(actor);
    assert.equal(allowed("/preview-dashboard", { actor }), false, change.toString());
  }
  assert.equal(allowed("/preview-dashboard", { actor: null }), false);
  assert.equal(privatePreviewTesterRequestAllowed(), false);
  assert.equal(privatePreviewTesterRequestAllowed({ session: session(), pathname: "/preview-dashboard", method: "GET", now: new Date("invalid") }), false);
  const codeOnly = session(ALL, "PREVIEW_CODE");
  codeOnly.user.privatePreviewAccess.passwordEnabled = false;
  assert.equal(allowed("/preview-dashboard", { actor: codeOnly }), true);
});

test("one or more exact, unique pillar grants are required", () => {
  for (const pillars of [[], null, "RETAIL", ["retail"], ["SCHOOLS"], ["UNKNOWN"], ["RETAIL", "RETAIL"], [...ALL, "RETAIL"]]) {
    assert.equal(allowed("/preview-dashboard", { actor: session(pillars) }), false, JSON.stringify(pillars));
  }
  assert.equal(allowed("/preview-dashboard", { pillars: ["HEALTH", "CORRECTIONS"] }), true);
});

test("each pillar only opens its reviewed dashboard paths and never a neighbour", () => {
  const cases = [
    ["RETAIL", ["/dashboard/retail", "/dashboard/retail/music"]],
    ["SCHOOL", ["/dashboard/school", "/dashboard/school-radio"]],
    ["ONLINE", ["/dashboard/radio", "/dashboard/radio/listen", "/dashboard/radio/schedule/cstation1", "/stations", "/stations/new", "/stations/cstation1"]],
    ["HEALTH", ["/dashboard/health", "/dashboard/health/setup"]],
    ["FAITH", ["/dashboard/faith", "/dashboard/faith/setup"]],
    ["ORGANISATIONS", ["/dashboard/organisations", "/dashboard/organisations/setup", "/dashboard/organisations/workspace"]],
    ["CORRECTIONS", ["/dashboard/corrections", "/dashboard/corrections/programmes", "/dashboard/corrections/requests", "/dashboard/corrections/network"]]
  ];
  for (const [pillar, paths] of cases) {
    for (const pathname of paths) {
      assert.equal(allowed(pathname, { pillars: [pillar] }), true, pathname);
      assert.equal(allowed(pathname, { pillars: ALL.filter((key) => key !== pillar) }), false, pathname);
      assert.equal(allowed(pathname, { pillars: [pillar], method: "HEAD" }), true, pathname);
      assert.equal(allowed(pathname, { pillars: [pillar], method: "POST" }), false, pathname);
    }
  }
  for (const pillar of ALL.filter((key) => key !== "CORRECTIONS")) {
    for (const workspace of ["autodj", "listen"]) {
      const pathname = `/dashboard/${workspace}/${pillar.toLowerCase()}`;
      assert.equal(allowed(pathname, { pillars: [pillar] }), true);
      assert.equal(allowed(pathname, { pillars: ALL.filter((key) => key !== pillar) }), false);
    }
  }
  assert.equal(allowed("/dashboard/autodj/corrections"), false);
  assert.equal(allowed("/dashboard/listen/corrections"), false);
});

test("read-only page and API views are permitted, including mixed pillar access", () => {
  for (const pathname of ["/preview-dashboard", "/dashboard", "/dashboard/help", "/dashboard/profile", "/api/me", "/api/me/security", "/api/notifications"]) {
    assert.equal(allowed(pathname, { pillars: ["CORRECTIONS"] }), true, pathname);
  }
  const cases = [
    ["SCHOOL", "/api/school-radio/announcements"], ["ONLINE", "/api/newsroom"],
    ["ONLINE", "/api/radio-advertising"], ["ORGANISATIONS", "/api/organisations/workspace"],
    ["CORRECTIONS", "/api/corrections/facilities"], ["CORRECTIONS", "/api/corrections/facilities/cfacility/staff"],
    ["CORRECTIONS", "/api/corrections/programmes/cprogramme/readiness"], ["CORRECTIONS", "/api/corrections/requests/crequest"]
  ];
  for (const [pillar, pathname] of cases) {
    assert.equal(allowed(pathname, { pillars: [pillar] }), true, pathname);
    assert.equal(allowed(pathname, { pillars: ALL.filter((key) => key !== pillar) }), false, pathname);
  }
  assert.equal(allowed("/api/product-channels", { pillars: ["HEALTH"] }), true);
  assert.equal(allowed("/api/product-channels", { pillars: ["RETAIL", "SCHOOL", "ONLINE", "CORRECTIONS"] }), false);
  assert.equal(allowed("/dashboard/health", { pillars: ["HEALTH", "CORRECTIONS"] }), true);
  assert.equal(allowed("/dashboard/corrections", { pillars: ["HEALTH", "CORRECTIONS"] }), true);
  assert.equal(allowed("/dashboard/faith", { pillars: ["HEALTH", "CORRECTIONS"] }), false);
});

test("ordinary shared tools cannot be reached with only an Inside grant", () => {
  for (const pathname of ["/dashboard/media", "/dashboard/programming", "/dashboard/studio", "/api/programming", "/api/programming/simple", "/api/studio/library", "/api/media/music", "/api/school-radio/audio-lab", "/api/school-radio/multitrack"]) {
    assert.equal(allowed(pathname, { pillars: ["CORRECTIONS"] }), false, pathname);
    assert.equal(allowed(pathname, { pillars: ["RETAIL"] }), true, pathname);
  }
  for (const pathname of ["/dashboard/players", "/dashboard/locations", "/api/player-setup", "/api/locations"]) {
    assert.equal(allowed(pathname, { pillars: ["CORRECTIONS", "ONLINE"] }), false, pathname);
    assert.equal(allowed(pathname, { pillars: ["HEALTH"] }), true, pathname);
  }
  for (const pathname of ["/dashboard/podcasts", "/api/podcasts", "/api/listener-analytics"]) {
    assert.equal(allowed(pathname, { pillars: ["RETAIL", "SCHOOL", "CORRECTIONS"] }), false, pathname);
    assert.equal(allowed(pathname, { pillars: ["FAITH"] }), true, pathname);
  }
});

test("all content, account, processing and publication mutations are denied; logout remains available", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get", "TRACE", "CONNECT"]) {
    for (const pathname of ["/preview-dashboard", "/dashboard/retail", "/api/me/security", "/api/programming", "/api/product-channels", "/api/corrections/facilities", "/api/school-radio/announcements"]) {
      assert.equal(allowed(pathname, { method }), false, `${method} ${pathname}`);
    }
  }
  assert.equal(privatePreviewTesterRequestAllowed({ session: session(ALL), pathname: "/preview-dashboard", now: NOW }), false);
  assert.equal(allowed("/api/auth/logout", { method: "POST" }), true);
  assert.equal(allowed("/api/auth/logout", { method: "GET" }), false);
});

test("privileged, registration, team, account, identity and cross-organisation surfaces stay closed", () => {
  const paths = [
    "/admin", "/admin/private-preview", "/api/admin/private-preview/codes", "/api/admin/promo-only/metadata-batch",
    "/dashboard/team", "/dashboard/account", "/dashboard/complimentary-access", "/api/organisation/team",
    "/api/organisation/team/accept", "/api/me/organisation", "/api/admin/organisations", "/api/organisations",
    "/register", "/api/auth/register", "/api/complimentary-access/redeem", "/team-invitation/accept",
    "/forgot-password", "/reset-password", "/api/auth/password-recovery/request", "/api/auth/password-recovery/reset",
    "/api/auth/login", "/api/auth/preview-code", "/api/auth/sso", "/api/v1/service-account", "/api/billing/webhooks/generic",
    "/api/school-radio/student-access", "/api/school-radio/network", "/api/school-radio/network/exchange",
    "/api/partner-demo/session", "/api/dj-access/session", "/api/corrections/contributor/session", "/school-student", "/dj"
  ];
  for (const pathname of paths) {
    for (const method of ["GET", "HEAD", "POST", "PATCH", "DELETE"]) assert.equal(allowed(pathname, { method }), false, `${method} ${pathname}`);
  }
});

test("GET is not treated as inherently safe: media, queue, token, job, export and public routes are not allowed", () => {
  const paths = [
    "/api/catalogue/music", "/api/admin/catalogue", "/api/promo-only/downloads/queue/713637",
    "/api/admin/promo-only/tracks/713637/download", "/api/studio/files/cfile", "/api/media/cmedia",
    "/api/media/cmedia/stream", "/api/media/upload", "/api/programming/simple/nonstop", "/api/programming/dj-access",
    "/api/programming/browser-live-studio", "/api/programming/external-live", "/api/programming/live-failover",
    "/api/programming/programme-director", "/api/programming/smart-playlists/cplaylist/publish",
    "/api/programming/autodj-expansion",
    "/api/reports/campaign-proof/exports", "/api/reports/campaign-proof/exports/cjob/download",
    "/api/listener-analytics/export", "/api/corrections/network/report/export",
    "/api/school-radio/audio-lab/projects/cproject/editor", "/api/school-radio/audio-lab/takes/ctake",
    "/api/school-radio/audio-lab/uploads", "/api/corrections/contributor/media/cmedia",
    "/api/stations/cstation/public-player", "/api/stations/cstation/website", "/api/stations/cstation/website/domains",
    "/stations/cstation/public-player", "/stations/cstation/website", "/api/school-radio/publication-policy",
    "/api/school-radio/publication-operations", "/api/public/stations/cstation", "/radio/station", "/listen/station", "/embed/station",
    "/dashboard/radio/distribution", "/dashboard/radio/networks", "/dashboard/radio/syndication", "/api/radio-networks",
    "/api/player/enrol", "/api/signage/enrol", "/api/studio/orders/corder/funding"
  ];
  for (const pathname of paths) for (const method of ["GET", "HEAD"]) assert.equal(allowed(pathname, { method }), false, pathname);
});

test("unknown, prefix-lookalike, encoded, traversing and non-canonical pathnames fail closed", () => {
  const paths = [
    undefined, null, {}, 123, "", "/", "dashboard/retail", "https://ruvanas.test/dashboard/retail",
    "//dashboard/retail", "/dashboard//retail", "/dashboard/retail/", "/dashboard/retail/../faith",
    "/dashboard/./retail", "/dashboard/retail/%2e%2e/faith", "/dashboard%2Fretail", "/dashboard/%72etail",
    "/dashboard/%252e%252e/admin", "/dashboard/%", "/dashboard/%GG", "/dashboard/retail%00",
    "/dashboard\\retail", "/dashboard/retail?next=/admin", "/dashboard/retail#admin", "/dashboard/retail;admin",
    "/dashboard/retail.json", "/dashboard/retail\u0000", "/dashboard/retail\n", "/dashboard/retail\t",
    "/dashboard/retail ", "/dashboard/Retail", "/dashboard/retailer", "/dashboard/retail/new-unreviewed-feature",
    "/dashboard/autodj/faith/extra", "/api/school-radio/announcements-export", "/api/corrections/facilities/new/action",
    "/api/corrections/facilities/" + "a".repeat(192), "/api/anything/new", "/_next/static/chunk.js",
    "/assets/private-track.mp3", "/favicon.ico", "/dashboard/retail" + "a".repeat(2048), "/dashboard/faith／setup"
  ];
  for (const pathname of paths) assert.equal(allowed(pathname), false, String(pathname));
});
