import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { canManageSubscriberLocations } from "../lib/subscriber-locations.mjs";
import { canManageSubscriberPlayers } from "../lib/subscriber-player-setup.mjs";
import { subscriberWorkflowRequestAllowed } from "../lib/private-preview-subscriber-testing.mjs";
import { subscriberTestingContext, SUBSCRIBER_TESTING_NOW, testCuid } from "./fixtures/private-preview-subscriber-testing.mjs";

const files = {
  location: "app/api/locations/route.js",
  renameLocation: "app/api/locations/[locationId]/route.js",
  area: "app/api/locations/[locationId]/zones/route.js",
  renameArea: "app/api/locations/[locationId]/zones/[zoneId]/route.js",
  player: "app/api/player-setup/route.js",
  replace: "app/api/player-setup/[playerId]/replace/route.js"
};
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key,
  (await readFile(new URL(`../${file}`, import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, "").replace(/^export /gm, "")])));

function harness({ allowed = true, role = "OWNER", contextPresent = true, membershipPresent = true, quotaEnabled = true,
  contextOverride, realGuard = false, routeIds = { locationId: "own-location", zoneId: "own-area", playerId: "own-player" } } = {}) {
  const calls = [];
  let bodyReads = 0;
  const context = contextOverride || (contextPresent ? { user: { id: "own-user" },
    membership: membershipPresent ? { organisationId: "own-org", role, organisation: { id: "own-org", subscription: {} } } : null } : null);
  const operation = name => async (_db, input) => { calls.push({ name, input }); return { ok: true, status: name === "createLocation" || name === "createPlayer" || name === "addZone" ? 201 : 200,
    location: { id: "own-location" }, zone: { id: "own-area" }, player: { id: "own-player", name: input.input?.name },
    replacement: { id: "new-player", name: input.replacementName, enrolmentExpiresAt: input.enrolmentExpiresAt }, configured: 1, limit: 1 }; };
  const dependencies = {
    NextResponse: { json: (body, init = {}) => Response.json(body, init) }, z,
    getActiveOrganisationContext: async () => context,
    subscriberWorkflowRequestAllowed: (received, request) => { assert.equal(received, context); calls.push({ name: "previewGate", request }); return realGuard ? subscriberWorkflowRequestAllowed(received, { ...request, now: SUBSCRIBER_TESTING_NOW }) : allowed; },
    canManageSubscriberLocations, canManageSubscriberPlayers,
    subscriberLocationAllowance: () => ({ enabled: quotaEnabled, limit: 1 }),
    subscriberPlayerAllowance: () => ({ enabled: quotaEnabled, limit: 1 }),
    listSubscriberPlayers: async () => [], subscriberPlayerReadiness: () => ({}),
    annotateRetailTestPlayerReadiness: async (_db, players) => { calls.push({ name: "annotateReadiness" }); return players; },
    createSubscriberLocation: operation("createLocation"), renameSubscriberLocation: operation("renameLocation"),
    addSubscriberZone: operation("addZone"), renameSubscriberZone: operation("renameZone"), createSubscriberPlayer: operation("createPlayer"),
    transitionPlayerLifecycle: operation("replacePlayer"),
    createPlayerToken: () => { calls.push({ name: "token" }); return "synthetic-code"; },
    playerTokenHash: value => `hash-${value}`, getRequestId: () => "synthetic-request",
    prisma: { location: { findMany: async () => [] }, player: { findFirst: async ({ where }) => { calls.push({ name: "lookupPlayer", where }); return where.organisationId === "own-org" && where.id === routeIds.playerId ? { id: where.id } : null; } } }
  };
  const routes = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key,
    new Function(...Object.keys(dependencies), `${source}\nreturn { ${key === "location" || key === "player" ? "GET, POST" : key.startsWith("rename") ? "PATCH" : "POST"} };`)(...Object.values(dependencies))]));
  return { calls, routes, bodyReads: () => bodyReads,
    request: body => ({ json: async () => { bodyReads += 1; return body; } }),
    params: Promise.resolve(routeIds) };
}

const actions = [
  ["location", "POST", "/api/locations"],
  ["renameLocation", "PATCH", "/api/locations/own-location"],
  ["area", "POST", "/api/locations/own-location/zones"],
  ["renameArea", "PATCH", "/api/locations/own-location/zones/own-area"],
  ["player", "POST", "/api/player-setup"],
  ["replace", "POST", "/api/player-setup/own-player/replace"]
];

test("all actual subscriber setup mutations deny capability before body, tokens or writes", async () => {
  for (const [key, method, pathname] of actions) {
    const h = harness({ allowed: false });
    const response = await h.routes[key][method](h.request({ subscriberTestingEnabled: true }), { params: h.params });
    assert.equal(response.status, 403, key);
    assert.equal(h.bodyReads(), 0, key);
    assert.deepEqual(h.calls.map(call => call.name), ["previewGate"], key);
    assert.equal(h.calls[0].request.pathname, pathname);
    assert.equal(h.calls[0].request.method, method);
  }
});

test("actual setup routes keep authentication, membership and manager restrictions", async () => {
  for (const [key, method] of actions) for (const options of [{ contextPresent: false }, { membershipPresent: false }, { role: "VIEWER" }, { role: "CONTENT_EDITOR" }]) {
    const h = harness(options);
    const response = await h.routes[key][method](h.request({}), { params: h.params });
    assert.equal(response.status, options.contextPresent === false ? 401 : 403, key);
    assert.equal(h.bodyReads(), 0);
    assert.equal(h.calls.length, 0);
  }
});

test("enabled setup routes use authenticated organisation and resolved URL parameters", async () => {
  for (const [key, method] of actions) {
    const h = harness();
    const response = await h.routes[key][method](h.request({ name: "Shop device", zoneId: "own-area", note: "Replacing tablet", replacementName: "New tablet", confirmReplacement: true, organisationId: "foreign-org", actorUserId: "foreign-user" }), { params: h.params });
    assert.ok([200, 201].includes(response.status), `${key}: ${response.status}`);
    const mutation = h.calls.find(call => call.input);
    assert.equal(mutation.input.organisationId, "own-org", key);
    assert.equal(mutation.input.actorUserId, "own-user", key);
    if (key === "renameLocation" || key === "area" || key === "renameArea") assert.equal(mutation.input.locationId, "own-location");
    if (key === "renameArea") assert.equal(mutation.input.zoneId, "own-area");
    if (key === "replace") {
      assert.equal(mutation.input.playerId, "own-player");
      assert.equal(mutation.input.action, "CREATE_REPLACEMENT");
    }
  }
});

test("GET canManage matches capability, role and existing allowance", async () => {
  for (const key of ["location", "player"]) for (const options of [{}, { allowed: false }, { role: "VIEWER" }, { quotaEnabled: false }]) {
    const h = harness(options);
    const body = await (await h.routes[key].GET()).json();
    assert.equal(body.canManage, Object.keys(options).length === 0);
    assert.equal(body.setupAccessEnabled, options.allowed !== false);
    assert.equal(h.bodyReads(), 0);
    assert.equal(h.calls.filter(call => call.name === "annotateReadiness").length, key === "player" ? 1 : 0);
  }
});

test("replacement still requires subscription capacity before reading submitted replacement", async () => {
  const h = harness({ quotaEnabled: false });
  const response = await h.routes.replace.POST(h.request({ confirmReplacement: true }), { params: h.params });
  assert.equal(response.status, 403);
  assert.equal(h.bodyReads(), 0);
  assert.deepEqual(h.calls.map(call => call.name), ["previewGate"]);
});

test("actual routes integrate the trusted enabled, disabled and expired tester capability", async () => {
  const routeIds = { locationId: testCuid(101), zoneId: testCuid(102), playerId: testCuid(103) };
  for (const state of ["enabled", "disabled", "session-expired", "grant-disabled", "wrong-pillar"]) {
    for (const [key, method] of actions) {
      const context = subscriberTestingContext({ enabled: state !== "disabled", organisationId: "own-org", userId: "own-user", pillars: state === "wrong-pillar" ? ["ONLINE"] : ["RETAIL"] });
      if (state === "session-expired") context.session.expiresAt = new Date(SUBSCRIBER_TESTING_NOW.getTime() - 1);
      if (state === "grant-disabled") context.user.privatePreviewAccess.enabled = false;
      const h = harness({ contextOverride: context, realGuard: true, routeIds });
      const response = await h.routes[key][method](h.request({ name: "Shop device", zoneId: routeIds.zoneId, note: "Replacing tablet", replacementName: "New tablet", confirmReplacement: true, subscriberTestingEnabled: true }), { params: h.params });
      if (state === "enabled") {
        assert.ok([200, 201].includes(response.status), `${state} ${key}: ${response.status}`);
        assert.ok(h.calls.some(call => call.input));
      } else {
        assert.equal(response.status, 403, `${state} ${key}`);
        assert.equal(h.bodyReads(), 0, `${state} ${key}`);
        assert.deepEqual(h.calls.map(call => call.name), ["previewGate"], `${state} ${key}`);
      }
    }
  }
});
