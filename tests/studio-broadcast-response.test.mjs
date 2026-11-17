import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { assertDestinationCapacity, broadcastMetadata, safeStudioBroadcastSession, safeStudioDestination } from "../lib/studio-broadcast.mjs";

const source = await readFile(new URL("../app/api/studio/broadcast/route.js", import.meta.url), "utf8");
const executable = source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const cuid = (letter) => `c${letter.repeat(24)}`;
const ciphertext = "synthetic-encrypted-source-credential";

function fixture() {
  const destination = {
    id: cuid("d"), organisationId: cuid("o"), type: "SHOUTCAST", enabled: true,
    name: "Synthetic destination", credentialEncrypted: ciphertext,
    listenerCount: 25, listenerTelemetryAt: null
  };
  return {
    destination,
    session: {
      id: cuid("s"), organisationId: cuid("o"), playoutSessionId: cuid("p"),
      status: "ACTIVE", revision: 0, automaticMetadata: "Synthetic programme",
      destinations: [{ sessionId: cuid("s"), destinationId: destination.id, state: "CONNECTED", destination }]
    }
  };
}

function assertSafe(value) {
  const json = JSON.stringify(value);
  assert.equal(json.includes("credentialEncrypted"), false);
  assert.equal(json.includes(ciphertext), false);
}

function harness({ authorised = true, pro = true } = {}) {
  const { destination, session } = fixture();
  const calls = { writes: 0 };
  const access = {
    ok: authorised, status: 401, error: "Sign in again.", user: { id: cuid("u") },
    organisation: { id: cuid("o") },
    entitlements: { studioLevel: "PRO", studioProEnabled: pro, planTierNumber: 5, studioExternalDestinationLimit: 10 }
  };
  const write = (result) => async () => { calls.writes++; return result; };
  const prisma = {
    studioBroadcastDestination: { findMany: async () => [destination] },
    studioBroadcastSession: {
      findMany: async () => [session], findFirst: async () => session,
      create: write(session), update: write({ ...session, revision: 1 })
    },
    studioPlayoutSession: {
      findMany: async () => [],
      findFirst: async () => ({ id: cuid("p"), currentItemId: null, items: [] })
    },
    station: { findMany: async () => [] },
    studioBroadcastSessionDestination: { count: async () => 0 },
    studioBroadcastCommand: { findUnique: async () => null, create: write({}) },
    auditLog: { create: write({}) }
  };
  const dependencies = {
    NextResponse: Response, z, prisma, requireActiveStudio: async () => access,
    ORGANISATION_MANAGER_ROLES: ["OWNER"], assertDestinationCapacity, broadcastMetadata,
    safeStudioBroadcastSession, safeStudioDestination, process: { env: {} },
    fetch: () => { throw new Error("Network access is forbidden in this synthetic route test."); }
  };
  const routes = new Function(...Object.keys(dependencies), `${executable}\nreturn { GET, POST };`)(...Object.values(dependencies));
  const request = (body) => new Request("https://studio.example.test/api/studio/broadcast", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "synthetic-response-check" },
    body: JSON.stringify(body)
  });
  return { destination, session, calls, routes, request };
}

test("broadcast session serialization removes every nested destination credential without mutating stored records", () => {
  const { session, destination } = fixture();
  const second = { ...destination, id: cuid("e"), credentialEncrypted: null, listenerCount: 3, listenerTelemetryAt: new Date("2026-10-18T00:00:00Z") };
  const original = { ...session, destinations: [...session.destinations, { destinationId: second.id, destination: second }] };
  const safe = safeStudioBroadcastSession(original);
  assertSafe(safe);
  assert.equal(safe.id, original.id);
  assert.equal(safe.automaticMetadata, original.automaticMetadata);
  assert.equal(safe.destinations[0].destination.credentialStored, true);
  assert.equal(safe.destinations[0].destination.listenerCount, null);
  assert.equal(safe.destinations[1].destination.credentialStored, false);
  assert.equal(safe.destinations[1].destination.listenerCount, 3);
  assert.equal(original.destinations[0].destination.credentialEncrypted, ciphertext);
  assert.deepEqual(safeStudioBroadcastSession({ id: "empty", destinations: [] }), { id: "empty", destinations: [] });
});

test("actual broadcast GET returns safe top-level destinations and nested sessions", async () => {
  const h = harness();
  const response = await h.routes.GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assertSafe(body);
  assert.equal(body.destinations[0].credentialStored, true);
  assert.equal(body.sessions[0].destinations[0].destination.credentialStored, true);
  assert.equal(h.calls.writes, 0);
});

test("actual start-broadcast response does not expose nested encrypted credentials", async () => {
  const h = harness();
  const response = await h.routes.POST(h.request({ action: "START_BROADCAST", playoutSessionId: cuid("p"), destinationIds: [cuid("d")] }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assertSafe(body);
  assert.equal(body.session.id, h.session.id);
  assert.equal(body.session.destinations[0].destination.credentialStored, true);
});

for (const action of ["STOP_BROADCAST", "SET_METADATA", "RESET_METADATA"]) {
  test(`actual ${action} response does not expose nested encrypted credentials`, async () => {
    const h = harness();
    const response = await h.routes.POST(h.request({ action, sessionId: cuid("s"), expectedRevision: 0, ...(action === "SET_METADATA" ? { metadata: "Synthetic update" } : {}) }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assertSafe(body);
    assert.equal(body.session.revision, 1);
    assert.equal(body.session.destinations[0].destination.credentialStored, true);
  });
}

test("broadcast response serialization does not weaken session or Studio Pro authorisation", async () => {
  for (const [options, expectedStatus] of [[{ authorised: false }, 401], [{ pro: false }, 403]]) {
    const h = harness(options);
    assert.equal((await h.routes.GET()).status, expectedStatus);
    assert.equal((await h.routes.POST(h.request({ action: "START_BROADCAST", playoutSessionId: cuid("p"), destinationIds: [cuid("d")] }))).status, expectedStatus);
    assert.equal(h.calls.writes, 0);
  }
});
