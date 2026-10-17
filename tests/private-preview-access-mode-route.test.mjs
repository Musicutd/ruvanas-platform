import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PrivatePreviewAccountError } from "../lib/private-preview-account-policy.mjs";
import { PREVIEW_RESPONSE_HEADERS, readPrivatePreviewBody } from "../lib/private-preview-request.mjs";

const source = await readFile(new URL("../app/api/admin/private-preview/testers/route.js", import.meta.url), "utf8");
const executable = source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

function harness({ admin = true, origin = "https://preview.example.test" } = {}) {
  const calls = [];
  const dependencies = {
    getCurrentSession: async () => ({ userId: "synthetic-admin", admin }),
    prisma: {},
    createPreviewTester: async (_db, options) => { calls.push({ action: "create", options }); return { accessMode: options.accessMode ?? "READ_ONLY" }; },
    updatePreviewTester: async (_db, options) => { calls.push({ action: "update", options }); return { accessMode: options.accessMode ?? "ONLINE_DRAFT" }; },
    PrivatePreviewAccountError,
    isPrivatePreviewAdminSession: (session) => session.admin,
    readPrivatePreviewPolicy: () => ({ enabled: true, valid: true, previewOrigin: "https://preview.example.test" }),
    PREVIEW_RESPONSE_HEADERS,
    readPrivatePreviewBody,
    consumeRateLimit: async () => ({ allowed: true }),
    createRateLimitKey: () => "synthetic-management-key",
    securityLog: () => {}
  };
  const routes = new Function(...Object.keys(dependencies), `${executable}\nreturn { POST, PATCH };`)(...Object.values(dependencies));
  const request = (method, body) => new Request("https://preview.example.test/api/admin/private-preview/testers", {
    method, headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return { calls, routes, request };
}

test("actual tester-management route accepts explicit access mode only through owner-authorised create/update", async () => {
  const h = harness();
  const created = await h.routes.POST(h.request("POST", { email: "tester@example.test", name: "Tester", pillars: ["ONLINE"], accessMode: "ONLINE_DRAFT" }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).tester.accessMode, "ONLINE_DRAFT");
  assert.equal(h.calls[0].options.actorUserId, "synthetic-admin");
  assert.equal(h.calls[0].options.accessMode, "ONLINE_DRAFT");
  const changed = await h.routes.PATCH(h.request("PATCH", { userId: "tester", pillars: ["ONLINE"], enabled: true, accessMode: "READ_ONLY" }));
  assert.equal(changed.status, 200);
  assert.equal(h.calls[1].options.accessMode, "READ_ONLY");
});

test("actual update route preserves omitted access-mode intent rather than defaulting to read-only", async () => {
  const h = harness();
  const response = await h.routes.PATCH(h.request("PATCH", { userId: "tester", pillars: ["ONLINE"], enabled: true }));
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(h.calls[0].options, "accessMode"), false);
  assert.equal((await response.json()).tester.accessMode, "ONLINE_DRAFT");
});

test("actual route keeps body allowlisting, admin-session and exact-origin checks ahead of mode changes", async () => {
  for (const options of [{ admin: false }, { origin: "https://other.example.test" }]) {
    const h = harness(options);
    assert.equal((await h.routes.PATCH(h.request("PATCH", { userId: "tester", pillars: ["ONLINE"], enabled: true, accessMode: "ONLINE_DRAFT" }))).status, 403);
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  assert.equal((await h.routes.PATCH(h.request("PATCH", { userId: "tester", pillars: ["ONLINE"], enabled: true, accessMode: "ONLINE_DRAFT", role: "SUPER_ADMIN" }))).status, 400);
  assert.equal(h.calls.length, 0);
});
