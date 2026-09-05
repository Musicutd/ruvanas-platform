import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDjAccessToken,
  djGrantAvailability,
  hashDjAccessToken,
  isDjAccessTokenActive,
  normalizeDjCapabilities,
  parseDjAccessGrantInput,
  safeDjAccessGrant
} from "../lib/dj-access.mjs";

const now = new Date("2026-09-05T10:00:00.000Z");

function grant(overrides = {}) {
  return { id: "grant-1", organisationId: "org-1", channelId: "channel-1", granteeUserId: "user-1", label: "Breakfast host", capabilities: ["VIEW_CHANNEL", "CONTROL_EXTERNAL_LIVE"], status: "ACTIVE", startsAt: new Date("2026-09-05T09:00:00.000Z"), endsAt: new Date("2026-09-05T12:00:00.000Z"), revokedAt: null, revokeReason: null, createdAt: new Date("2026-09-04T12:00:00.000Z"), channel: { id: "channel-1", name: "Main" }, grantee: { id: "user-1", name: "Presenter", email: "presenter@example.com" }, tokens: [], ...overrides };
}

test("DJ grants are bounded, channel scoped and tied to a named member", () => {
  const parsed = parseDjAccessGrantInput({ label: " Friday host ", channelId: "channel-1", granteeUserId: "user-1", startsAt: "2026-09-05T10:05:00.000Z", endsAt: "2026-09-05T12:05:00.000Z", capabilities: ["CONTROL_EXTERNAL_LIVE"] }, now);
  assert.equal(parsed.label, "Friday host");
  assert.deepEqual(parsed.capabilities, ["VIEW_CHANNEL", "CONTROL_EXTERNAL_LIVE"]);
  assert.throws(() => parseDjAccessGrantInput({ ...parsed, startsAt: now, endsAt: new Date(now.getTime() + 14 * 60_000) }, now), /at least 15 minutes/);
  assert.throws(() => parseDjAccessGrantInput({ ...parsed, startsAt: now, endsAt: new Date(now.getTime() + 13 * 60 * 60_000) }, now), /cannot exceed 12 hours/);
});

test("recording authority cannot exist without Browser Live Studio authority", () => {
  assert.throws(() => normalizeDjCapabilities(["RECORD_LIVE_SESSION"]), /requires Browser Live Studio/);
  assert.deepEqual(normalizeDjCapabilities(["START_BROWSER_STUDIO", "RECORD_LIVE_SESSION"]), ["VIEW_CHANNEL", "START_BROWSER_STUDIO", "RECORD_LIVE_SESSION"]);
  assert.throws(() => normalizeDjCapabilities(["PLATFORM_ADMIN"]), /supported DJ permissions/);
});

test("private DJ tokens are opaque, hashed and end with the grant", () => {
  const first = createDjAccessToken(now, new Date("2026-09-05T12:00:00.000Z"));
  const second = createDjAccessToken(now, new Date("2026-09-05T12:00:00.000Z"));
  assert.match(first.rawToken, /^[a-f0-9]{64}$/);
  assert.notEqual(first.rawToken, second.rawToken);
  assert.equal(first.tokenHash, hashDjAccessToken(first.rawToken));
  assert.notEqual(first.rawToken, first.tokenHash);
  assert.equal(first.expiresAt.toISOString(), "2026-09-05T12:00:00.000Z");
  assert.equal(isDjAccessTokenActive({ expiresAt: first.expiresAt, revokedAt: null }, now), true);
  assert.equal(isDjAccessTokenActive({ expiresAt: first.expiresAt, revokedAt: now }, now), false);
});

test("DJ authority fails closed outside the window, after revocation and without capability", () => {
  assert.deepEqual(djGrantAvailability(grant(), now, "CONTROL_EXTERNAL_LIVE"), { allowed: true, reason: null });
  assert.equal(djGrantAvailability(grant({ startsAt: new Date("2026-09-05T11:00:00.000Z") }), now).reason, "DJ_ACCESS_NOT_STARTED");
  assert.equal(djGrantAvailability(grant({ endsAt: now }), now).reason, "DJ_ACCESS_EXPIRED");
  assert.equal(djGrantAvailability(grant({ status: "REVOKED", revokedAt: now }), now).reason, "DJ_ACCESS_REVOKED");
  assert.equal(djGrantAvailability(grant(), now, "RECORD_LIVE_SESSION").reason, "DJ_CAPABILITY_DENIED");
});

test("safe grant responses omit token hashes and preserve an explainable state", () => {
  const safe = safeDjAccessGrant(grant({ tokens: [{ tokenHash: "must-not-leak", expiresAt: new Date("2026-09-05T12:00:00.000Z"), lastUsedAt: null, revokedAt: null }] }), now);
  assert.equal(safe.state, "ACTIVE");
  assert.equal(safe.token.active, true);
  assert.equal(JSON.stringify(safe).includes("must-not-leak"), false);
  assert.equal("organisationId" in safe, false);
});

test("DJ routes enforce existing identity, tenant/channel scope and manager-only grant control", async () => {
  const [listRoute, actionRoute, sessionRoute, liveRoute, service, schema, migration, page, roadmap] = await Promise.all([
    readFile(new URL("../app/api/programming/dj-access/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/dj-access/[grantId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dj-access/session/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/external-live/[sourceId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/dj-access-service.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261009000000_stage_19_8_dj_access/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/dj/access/DjAccessClient.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-online-radio-index.md", import.meta.url), "utf8")
  ]);
  assert.match(listRoute, /OWNER.*MANAGER/);
  assert.match(actionRoute, /ROTATE.*REVOKE/);
  assert.match(sessionRoute, /getCurrentUser/);
  assert.match(sessionRoute, /httpOnly|setDjAccessCookie/);
  assert.match(liveRoute, /requiredCapability: "CONTROL_EXTERNAL_LIVE"/);
  assert.match(service, /granteeUserId !== userId/);
  assert.match(service, /organisationId.*channelId.*requiredCapability/);
  assert.match(schema, /DjAccessGrant[\s\S]*granteeUserId/);
  assert.match(migration, /one_open_grant_per_presenter_channel/);
  assert.match(migration, /one_live_token_per_grant/);
  assert.match(migration, /grantee_membership_fkey/);
  assert.doesNotMatch(page, /tokenHash/);
  assert.match(page, /replaceState/);
  assert.match(roadmap, /19\.8 \| DJ Access \| DEPLOYED/);
});
