import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalogueTestOwnerSessionValid } from "../lib/catalogue-test-service.mjs";
import { readPrivatePreviewBody } from "../lib/private-preview-request.mjs";
import { CATALOGUE_TEST_REASON_LABELS, TEST_RADIO_CATALOGUE_TEST } from "../lib/online-radio-catalogue-test.mjs";

const source = await readFile(new URL("../app/api/admin/stations/[stationId]/catalogue-test/route.js", import.meta.url), "utf8");
const executable = source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
function fixture({ role = "SUPER_ADMIN", env = {}, error = null } = {}) {
  const calls = [];
  const session = { id: "cmsession000000001", userId: "cmowner00000000001", user: { id: "cmowner00000000001", role },
    authMethod: "PASSWORD", revokedAt: null, expiresAt: new Date(Date.now() + 600_000) };
  const operation = action => async (_db, options) => { calls.push({ action, options }); if (error) throw error; return { id: "cmtest000000000001", status: action === "prepare" ? "PREPARED" : "ARMED" }; };
  const dependencies = { NextResponse: { json: (body, options = {}) => Response.json(body, options) }, prisma: {},
    getCurrentSession: async () => session, catalogueTestOwnerSessionValid, TEST_RADIO_CATALOGUE_TEST, CATALOGUE_TEST_REASON_LABELS, readPrivatePreviewBody,
    catalogueTestDashboard: operation("inspect"), prepareCatalogueTest: operation("prepare"), armCatalogueTest: operation("arm"), stopCatalogueTest: operation("stop"), process: { env } };
  const routes = new Function(...Object.keys(dependencies), `${executable}\nreturn {GET,POST};`)(...Object.values(dependencies));
  const params = stationId => ({ params: Promise.resolve({ stationId: stationId || TEST_RADIO_CATALOGUE_TEST.stationId }) });
  const request = (body, origin = TEST_RADIO_CATALOGUE_TEST.origin) => new Request(`${TEST_RADIO_CATALOGUE_TEST.origin}/api/test`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }) }, body: JSON.stringify(body) });
  return { calls, routes, params, request };
}
test("actual test route rejects foreign station and non-owner access without invoking service", async () => {
  for (const role of ["OWNER", "ADMIN", "MANAGER"]) {
    const f = fixture({ role }); assert.equal((await f.routes.GET(null, f.params())).status, 403); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); assert.equal((await f.routes.POST(f.request({ action: "prepare" }), f.params("other-station"))).status, 404); assert.equal(f.calls.length, 0);
});
test("actual mutations require exact canonical origin and a bounded allowlisted JSON command", async () => {
  const f = fixture();
  for (const origin of [null, "https://ruvanas.com", "https://attacker.example"]) assert.equal((await f.routes.POST(f.request({ action: "prepare" }, origin), f.params())).status, 403);
  for (const body of [{ action: "play", grant: {} }, { action: "prepare", role: "SUPER_ADMIN" }, { action: "arm", sessionId: "bad" }, { action: "stop", sessionId: "bad" }]) assert.equal((await f.routes.POST(f.request(body), f.params())).status, 400);
  const oversized = new Request("https://www.ruvanas.com/api/test", { method: "POST", headers: { Origin: TEST_RADIO_CATALOGUE_TEST.origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", sessionId: "x".repeat(5000) }) });
  assert.equal((await f.routes.POST(oversized, f.params())).status, 400);
  assert.equal(f.calls.length, 0);
});
test("GET only inspects and prepare never arms; start remains a default-disabled explicit service gate", async () => {
  const f = fixture();
  const inspected = await f.routes.GET(null, f.params());
  assert.equal(inspected.status, 200); assert.match(inspected.headers.get("cache-control"), /no-store/);
  assert.equal(f.calls[0].action, "inspect"); assert.equal(f.calls[0].options.startEnabled, false);
  assert.equal((await f.routes.POST(f.request({ action: "prepare" }), f.params())).status, 200);
  assert.equal(f.calls[1].action, "prepare"); assert.equal(f.calls.some(call => call.action === "arm"), false);
  await f.routes.POST(f.request({ action: "arm", sessionId: "cmtest000000000001", publicExposureAccepted: true }), f.params());
  assert.equal(f.calls[2].options.startEnabled, false);
  assert.equal(f.calls[2].options.publicExposureAccepted, true);
});
test("only exact true startup flag can be forwarded, never a client-supplied gate", async () => {
  const f = fixture({ env: { RUVANAS_CATALOGUE_TEST_START_ENABLED: "true" } });
  await f.routes.POST(f.request({ action: "arm", sessionId: "cmtest000000000001", publicExposureAccepted: true }), f.params());
  assert.equal(f.calls[0].options.startEnabled, true);
  assert.equal((await f.routes.POST(f.request({ action: "arm", sessionId: "cmtest000000000001", startEnabled: true }), f.params())).status, 400);
});
test("uncertain mutation errors never promise no start or reveal driver credentials", async () => {
  const f = fixture({ error: new Error("postgresql://private:secret@internal") });
  const response = await f.routes.POST(f.request({ action: "arm", sessionId: "cmtest000000000001", publicExposureAccepted: true }), f.params());
  const body = await response.json();
  assert.equal(response.status, 503); assert.match(body.error, /could not be confirmed/);
  assert.doesNotMatch(JSON.stringify(body), /postgresql|secret|Nothing has been started/);
});
test("owner panel is test-scoped and does not autoplay, auto-arm or imply private Centova", async () => {
  const ui = await readFile(new URL("../app/admin/stations/[stationId]/setup/CatalogueStreamTest.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/admin/stations/[stationId]/setup/page.js", import.meta.url), "utf8");
  assert.match(page, /station\.id === "cmvcnbwi20008hr23sd76psi8" && <CatalogueStreamTest/);
  assert.match(ui, /Preparing sends no audio/); assert.match(ui, /publicly reachable/);
  assert.match(ui, /!state\.startEnabled \|\| !exposureAccepted/);
  assert.doesNotMatch(ui, /<audio|autoPlay|navigator\.mediaDevices/);
  assert.match(ui, /not proof that a listener heard/);
});

test("owner status never labels an unconfirmed stop or a failed refresh as audio off", async () => {
  const ui = await readFile(new URL("../app/admin/stations/[stationId]/setup/CatalogueStreamTest.js", import.meta.url), "utf8");
  const helper = ui.match(/export function catalogueTestAudioStatus\([\s\S]*?\n}\r?\n(?=export default)/)?.[0];
  assert.ok(helper, "The status decision must remain directly testable without starting a browser or stream.");
  const status = new Function(`${helper.replace("export function", "function")}\nreturn catalogueTestAudioStatus;`)();
  assert.equal(status({ status: "FAILED", endedReason: "CATALOGUE_TEST_STOP_UNCONFIRMED" }), "Stop not confirmed — needs attention");
  assert.equal(status({ status: "FAILED", events: [{ kind: "TEST_ENDED", details: { stopConfirmed: false } }] }), "Stop not confirmed — needs attention");
  assert.equal(status({ status: "COMPLETE" }, "The status refresh failed."), "Audio status unavailable — refresh to confirm");
  assert.equal(status({ status: "RUNNING" }, "The status refresh failed."), "Audio status unavailable — refresh to confirm");
  for (const state of ["ARMED", "RUNNING"]) assert.equal(status({ status: state }), "Test running or starting");
  for (const state of ["PREPARED", "COMPLETE", "STOPPED", "FAILED", "EXPIRED"]) {
    assert.equal(status({ status: state }), "No active Ruvanas test");
  }
  assert.match(ui, /catalogueTestAudioStatus\(state\.latest, error, attentionRequired\)/);
  assert.doesNotMatch(ui, /"Audio off"/);
});

test("an unresolved safety hold overrides newer inactive-looking data and blocks both preparation and start", async () => {
  const ui = await readFile(new URL("../app/admin/stations/[stationId]/setup/CatalogueStreamTest.js", import.meta.url), "utf8");
  const helper = ui.match(/export function catalogueTestAudioStatus\([\s\S]*?\n}\r?\n(?=export default)/)?.[0];
  const status = new Function(`${helper.replace("export function", "function")}\nreturn catalogueTestAudioStatus;`)();
  for (const latest of [null, { status: "PREPARED" }, { status: "COMPLETE" }, { status: "EXPIRED" }]) {
    assert.equal(status(latest, "", true), "Stop not confirmed — needs attention");
  }
  assert.equal(status({ status: "COMPLETE" }, "The status refresh failed.", true), "Stop not confirmed — needs attention");
  assert.match(ui, /const attentionRequired = state\?\.attentionRequired === true/);
  assert.match(ui, /command\("prepare"\)\} disabled=\{busy \|\| active \|\| attentionRequired/);
  assert.match(ui, /command\("arm"\)\} disabled=\{busy \|\| attentionRequired \|\| !state\.startEnabled/);
  assert.match(ui, /Preparing and starting new tests are blocked/);
  assert.match(ui, /Refreshing does not clear the hold/);
  assert.match(ui, /onClick=\{refresh\} disabled=\{busy\}/);
  assert.match(ui, /active && <button[^\n]+command\("stop"\)/);
});
