import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readPrivatePreviewBody, PREVIEW_RESPONSE_HEADERS } from "../lib/private-preview-request.mjs";
import { normalizeRetailStreamEvidence } from "../lib/retail-test-stream-evidence.mjs";
import { retailTestStreamManifest } from "../lib/retail-test-player-access.mjs";

const source = {};
for (const name of ["state", "manifest", "enrol", "stream-evidence"]) source[name] =
  (await readFile(new URL(`../app/api/player/${name}/route.js`, import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, "").replace(/^export /gm, "");
const player = { id: "player", name: "Shop", status: "ONLINE", sourcePasswordEncrypted: "never-return-this", sessionTokenHash: "private",
  zone: { name: "Main", location: { name: "Shop" } }, subscriberTestStream: { kind: "RETAIL_SHARED_STREAM", stationId: "retail-station",
    name: "Retail radio", channelId: "channel", streamUrl: "https://ruvanastestretail-radio105network.radioca.st/stream", expiresAt: "2026-11-23T00:00:00Z" } };
function harness(overrides = {}) {
  const effects = [];
  const bindings = { process: { env: { RUVANAS_PRIVATE_PREVIEW_ENABLED: "1" } },
    NextResponse: { json: (body, init = {}) => Response.json(body, init) },
    getCurrentPlayer: async () => player, headers: PREVIEW_RESPONSE_HEADERS, readPrivatePreviewBody, normalizeRetailStreamEvidence,
    PLAYER_HEARTBEAT_INTERVAL_SECONDS: 30, retailTestStreamManifest,
    readPlayerInstanceId: () => "11111111-1111-4111-8111-111111111111",
    claimPlayerListenerLease: async () => { effects.push("lease"); return { ok: true, limit: 1, activeCount: 1 }; },
    recordRetailStreamEvidence: async (_db, args) => { effects.push(["evidence", args.input]); return { progressObserved: true }; },
    prisma: new Proxy({}, { get: () => { throw Error("No unrelated database access allowed"); } }),
    createPlayerToken: () => "a".repeat(43), playerTokenHash: () => "b".repeat(64),
    enrolPlayerCode: async () => { effects.push("enrol"); return { id: "player" }; },
    setPlayerCookie: async () => { effects.push("cookie"); },
    resolvePlayerProgramming: () => { throw Error("Generic programming must not run"); }, ...overrides };
  return { effects, handler(name, method = "POST") { return new Function(...Object.keys(bindings), `${source[name]}\nreturn ${method};`)(...Object.values(bindings)); } };
}
const request = (path, body, origin = "https://www.ruvanas.com") => new Request(`https://www.ruvanas.com/api/player/${path}`, {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body)
});

test("state and manifest serve only the stream view after a successful instance lease", async () => {
  for (const name of ["state", "manifest"]) {
    const h = harness(), response = await h.handler(name, "GET")({});
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
    const body = await response.json(); assert.equal(body.subscriberTestStream.kind, "RETAIL_SHARED_STREAM");
    assert.doesNotMatch(JSON.stringify(body), /never-return-this|sessionTokenHash/); assert.deepEqual(h.effects, ["lease"]);
    const denied = harness({ claimPlayerListenerLease: async () => ({ ok: false, status: 429 }) });
    assert.equal((await denied.handler(name, "GET")({})).status, 429);
  }
});

test("stream evidence checks origin, exact supported fields, authorization and lease before persistence", async () => {
  const report = { state: "PLAYING", positionSeconds: 10, observedAt: new Date().toISOString() };
  const h = harness(); assert.equal((await h.handler("stream-evidence")(request("stream-evidence", report))).status, 200);
  assert.deepEqual(h.effects, ["lease", ["evidence", report]]);
  for (const [body, origin, expected] of [[report, "https://other.example", 403], [{ ...report, trackId: "forged" }, undefined, 400],
    [{ ...report, state: "UNKNOWN" }, undefined, 400], [{ ...report, positionSeconds: -1 }, undefined, 400]]) {
    const h = harness(); assert.equal((await h.handler("stream-evidence")(request("stream-evidence", body, origin))).status, expected);
    assert.deepEqual(h.effects, []);
  }
  for (const [value, expected] of [[null, 401], [{ ...player, subscriberTestStream: null }, 403]]) {
    const h = harness({ getCurrentPlayer: async () => value });
    assert.equal((await h.handler("stream-evidence")(request("stream-evidence", report))).status, expected); assert.deepEqual(h.effects, []);
  }
});

test("enrolment sets its HttpOnly session cookie only after an accepted one-time code", async () => {
  const h = harness(); assert.equal((await h.handler("enrol")(request("enrol", { code: "x".repeat(43) }))).status, 200);
  assert.deepEqual(h.effects, ["enrol", "cookie"]);
  const invalid = harness({ enrolPlayerCode: async () => null });
  assert.equal((await invalid.handler("enrol")(request("enrol", { code: "x".repeat(43) }))).status, 400); assert.deepEqual(invalid.effects, []);
  for (const [body, origin, status] of [[{ code: "x".repeat(43) }, "https://other.example", 403], [{ code: "short" }, undefined, 400],
    [{ code: "x".repeat(43), organisationId: "foreign" }, undefined, 400]]) {
    const h = harness(); assert.equal((await h.handler("enrol")(request("enrol", body, origin))).status, status); assert.deepEqual(h.effects, []);
  }
});
