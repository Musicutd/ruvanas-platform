import assert from "node:assert/strict";
import test from "node:test";
import { privatePreviewTesterRequestAllowed, isPrivatePreviewOnlineDraftSession } from "../lib/private-preview-tester-policy.mjs";
import { PREVIEW_ONLINE_DRAFT_PLAN, PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { ONLINE_DRAFT_LIMITS, onlineDraftChannelWhere, onlineDraftMusicModeWhere, lockOnlineDraftOrganisation } from "../lib/private-preview-online-draft.mjs";

const NOW = new Date("2026-10-17T17:00:00Z");
const EXPIRY = new Date("2026-11-16T17:00:00Z");
const ID = "c" + "a".repeat(24);
function actor(plan = PREVIEW_ONLINE_DRAFT_PLAN) {
  const grant = { userId: "test-user", organisationId: "test-org", enabled: true, passwordEnabled: true, pillars: ["ONLINE"], expiresAt: EXPIRY };
  return { activeOrganisationId: "test-org", authMethod: "PREVIEW_PASSWORD", revokedAt: null, user: {
    id: "test-user", role: "OWNER", privatePreviewAccess: grant, memberships: [{ organisationId: "test-org", role: "OWNER", organisation: {
      enterpriseSecurityPolicy: null, subscription: { organisationId: "test-org", plan: { ...plan }, billingContract: null,
        status: "TRIAL", currentPeriodEnd: EXPIRY, complimentaryAccessActive: false,
        schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false, ...previewTesterOverrides(["ONLINE"]) }
    } }]
  } };
}
const request = (pathname, method = "GET", session = actor()) => privatePreviewTesterRequestAllowed({ pathname, method, session, now: NOW });

test("only explicit exact-plan Online Radio draft requests are writable", () => {
  const writes = [["/api/stations", "POST"], ["/api/programming/simple", "POST"],
    [`/api/programming/simple/${ID}`, "PATCH"], [`/api/programming/simple/${ID}`, "POST"],
    ["/api/programming/advanced-scheduler", "POST"], [`/api/programming/advanced-scheduler/${ID}`, "PUT"]];
  for (const [pathname, method] of writes) {
    assert.equal(request(pathname, method), true, pathname);
    assert.equal(request(pathname, method, actor(PREVIEW_TESTER_PLAN)), false, `read-only ${pathname}`);
    for (const verb of ["DELETE", "OPTIONS", "TRACE", method.toLowerCase()]) assert.equal(request(pathname, verb), false);
  }
  assert.equal(request(`/api/programming/advanced-scheduler/${ID}/preview`), true);
  assert.equal(request(`/api/programming/advanced-scheduler/${ID}/preview`, "GET", actor(PREVIEW_TESTER_PLAN)), false);
});

test("no static route collision can enable live events, nonstop, publication or provisioning", () => {
  const forbidden = ["/api/programming/simple/events", `/api/programming/simple/events/${ID}`, "/api/programming/simple/nonstop",
    "/api/programming/autodj", "/api/programming", `/api/programming/advanced-scheduler/${ID}/versions/${ID}/publish`,
    `/api/programming/advanced-scheduler/${ID}/archive`, `/api/programming/smart-playlists/${ID}/publish`,
    `/api/stations/${ID}/setup`, `/api/stations/${ID}/public-player`, `/api/stations/${ID}/website`,
    "/api/media/upload", "/api/media/music", "/api/school-radio/audio-lab/uploads", "/api/school-radio/multitrack",
    "/api/auth/register", "/register", "/api/organisation/team", "/api/admin/stations", "/api/billing/checkout",
    "/api/player/enrol", "/api/programming/browser-live-studio", "/api/programming/external-live", "/api/programming/dj-access",
    `/api/programming/simple/${ID}/new-operation`, "/api/programming/simple/future-operation"];
  for (const pathname of forbidden) for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(request(pathname, method), false, `${method} ${pathname}`);
  for (const pathname of ["/dashboard/radio/listen", "/dashboard/listen/online", "/api/catalogue/music", `/api/media/${ID}/stream`, `/listen/${ID}`, `/radio/${ID}`])
    for (const method of ["GET", "HEAD"]) assert.equal(request(pathname, method), false, pathname);
});

test("role, pillar or caller-supplied flag cannot elevate a read-only or invalid session", () => {
  const readonly = actor(PREVIEW_TESTER_PLAN); readonly.accessMode = "ONLINE_DRAFT"; readonly.user.privatePreviewAccess.accessMode = "ONLINE_DRAFT";
  assert.equal(request("/api/stations", "POST", readonly), false);
  const changes = [
    s => { s.user.memberships[0].organisation.subscription.plan.monthlyPriceCents = 1; },
    s => { s.user.memberships[0].organisation.subscription.plan.storageLimitGb = 1; },
    s => { s.user.memberships[0].organisation.subscription.billingContract = {}; },
    s => { s.user.memberships[0].organisation.subscription.status = "ACTIVE"; },
    s => { s.user.privatePreviewAccess.pillars = ["ONLINE", "RETAIL"]; },
    s => { s.activeOrganisationId = "other-org"; },
    s => { s.user.memberships[0].organisationId = "other-org"; },
    s => { s.user.memberships.push(structuredClone(s.user.memberships[0])); },
    s => { s.user.privatePreviewAccess.enabled = false; },
    s => { s.user.privatePreviewAccess.expiresAt = NOW; },
    s => { s.authMethod = "PASSWORD"; },
    s => { s.user.role = "SUPER_ADMIN"; },
    s => { s.revokedAt = NOW; }
  ];
  for (const change of changes) { const s = actor(); change(s); assert.equal(isPrivatePreviewOnlineDraftSession(s, NOW), false, change.toString()); assert.equal(request("/api/stations", "POST", s), false); }
});

test("draft queries retain organisation, pending unconnected station and private source boundaries", () => {
  assert.deepEqual(onlineDraftChannelWhere("a"), { organisationId: "a", status: "DRAFT", musicRightsUse: "ONLINE_RADIO", station: {
    organisationId: "a", productFamily: "ONLINE", status: "PENDING_SETUP", publicPlayerEnabled: false, stationWebsiteEnabled: false, streamConfig: null
  } });
  assert.deepEqual(onlineDraftMusicModeWhere("a"), { organisationId: "a", status: "DRAFT", source: "SMART_PLAYLIST", smartPlaylist: {
    organisationId: "a", status: "DRAFT", rightsUse: "ONLINE_RADIO", simpleBuildMode: { not: null }
  } });
  assert.deepEqual(ONLINE_DRAFT_LIMITS, { playlists: 20, scheduleVersions: 20 });
  assert.equal(Object.isFrozen(ONLINE_DRAFT_LIMITS), true);
});

test("bounded metadata writes lock only the named organisation with parameterised SQL", async () => {
  let seen;
  await lockOnlineDraftOrganisation({ $queryRaw: async (parts, value) => { seen = { sql: parts.join("?"), value }; return [{ id: value }]; } }, "tenant-not-SQL");
  assert.equal(seen.sql, 'SELECT "id" FROM "Organisation" WHERE "id" = ? FOR UPDATE');
  assert.equal(seen.value, "tenant-not-SQL");
  await assert.rejects(lockOnlineDraftOrganisation({ $queryRaw: async () => [] }, "missing"), { code: "DRAFT_WORKSPACE_UNAVAILABLE" });
});
