import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const files = [
  ["media", "GET", "app/api/player/media/[mediaAssetId]/route.js"],
  ["live", "GET", "app/api/player/live/[sourceId]/route.js"],
  ["proof", "POST", "app/api/player/proof-of-play/route.js"],
  ["commands", "GET", "app/api/player/commands/route.js"],
  ["acknowledge", "POST", "app/api/player/commands/[commandId]/acknowledge/route.js"]
];
const sources = await Promise.all(files.map(async ([name, method, file]) => ({ name, method,
  source: (await readFile(new URL(`../${file}`, import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, "").replace(/^export /gm, "") })));

function harness(player) {
  const effects = [], reads = [];
  const dependencies = {
    NextResponse: { json: (body, init = {}) => Response.json(body, init) }, z,
    getCurrentPlayer: async () => player,
    prisma: new Proxy({}, { get: (_target, name) => { effects.push(`database:${String(name)}`); throw Error("Unexpected database access"); } }),
    isPlayerListenerTokenActive: async () => { effects.push("listener"); return false; },
    deliverNextPlayerCommand: async () => { effects.push("command"); return null; },
    acknowledgePlayerCommand: async () => { effects.push("acknowledge"); return { ok: true, status: 200, command: null }; }
  };
  const routes = sources.map(({ name, method, source }) => ({ name, method,
    handler: new Function(...Object.keys(dependencies), `${source}\nreturn ${method};`)(...Object.values(dependencies)) }));
  return { routes, effects, reads,
    request: { json: async () => { reads.push("body"); return {}; }, nextUrl: { searchParams: { get: () => { reads.push("query"); return "synthetic"; } } } },
    params: Promise.resolve({ mediaAssetId: "private-asset", sourceId: "private-source", commandId: "private-command" }) };
}

test("Retail stream-only players cannot reach generic media, relay, proof or command capabilities", async () => {
  const h = harness({ id: "retail-player", status: "ONLINE", subscriberTestStream: { stationId: "test-retail" } });
  for (const route of h.routes) {
    const response = await route.handler(h.request, { params: h.params });
    assert.equal(response.status, 403, route.name);
    assert.match((await response.json()).error, /approved Retail stream/);
    assert.deepEqual(h.effects, [], route.name);
    assert.deepEqual(h.reads, [], route.name);
  }
});

test("missing or disabled player identity still fails before the special Retail path", async () => {
  for (const player of [null, { id: "disabled-player", status: "DISABLED", subscriberTestStream: {} }]) {
    const h = harness(player);
    for (const route of h.routes) assert.equal((await route.handler(h.request, { params: h.params })).status, 401, route.name);
    assert.deepEqual(h.effects, []); assert.deepEqual(h.reads, []);
  }
});

test("ordinary enrolled players retain their downstream authorization and validation paths", async () => {
  for (const routeName of files.map(([name]) => name)) {
    const h = harness({ id: "ordinary-player", status: "ONLINE" }), route = h.routes.find(row => row.name === routeName);
    const response = await route.handler(h.request, { params: h.params });
    if (["media", "live"].includes(routeName)) {
      assert.equal(response.status, 429); assert.deepEqual(h.effects, ["listener"]);
    } else if (routeName === "proof") {
      assert.equal(response.status, 400); assert.deepEqual(h.effects, []); assert.deepEqual(h.reads, ["body"]);
    } else {
      assert.equal(response.status, 200); assert.deepEqual(h.effects, [routeName === "commands" ? "command" : "acknowledge"]);
    }
  }
});
