import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("subscriber Studio cannot enter or submit external streaming details", async () => {
  const [ui, route] = await Promise.all([
    source("../app/dashboard/studio/StudioBroadcastClient.js"),
    source("../app/api/studio/broadcast/route.js")
  ]);
  assert.doesNotMatch(ui, /name="(?:host|port|credential|mountOrService)"/);
  assert.doesNotMatch(ui, /act\("CREATE_EXTERNAL"/);
  assert.doesNotMatch(ui, /act\("SET_ENABLED"/);
  assert.match(route, /input\.action === "CREATE_EXTERNAL" \|\| input\.action === "SET_ENABLED"/);
  assert.match(route, /Only Ruvanas Super Admin can configure streaming destinations/);
  assert.doesNotMatch(route, /studioBroadcastDestination\.create\(/);
});

test("subscriber External Live cannot enter an endpoint or source credential", async () => {
  const [ui, route] = await Promise.all([
    source("../app/dashboard/programming/ExternalLiveWorkspace.js"),
    source("../app/api/programming/external-live/route.js")
  ]);
  assert.doesNotMatch(ui, /name="(?:streamUrl|credentialSecret)"/);
  assert.doesNotMatch(ui, /fetch\("\/api\/programming\/external-live", \{ method: "POST"/);
  assert.match(route, /Only Ruvanas Super Admin can enter external streaming source details/);
  assert.doesNotMatch(route, /createExternalLiveSource\(/);
});

test("Super Admin station setup owns both streaming profile creation paths", async () => {
  const [page, form, route] = await Promise.all([
    source("../app/admin/stations/[stationId]/setup/page.js"),
    source("../app/admin/stations/[stationId]/setup/AdminStreamingProfiles.js"),
    source("../app/api/admin/stations/[stationId]/streaming-profiles/route.js")
  ]);
  assert.match(page, /user\?\.role !== "SUPER_ADMIN"/);
  assert.match(page, /AdminStreamingProfiles/);
  assert.match(form, /Save destination/);
  assert.match(form, /Save live source/);
  assert.match(route, /requirePlatformAdmin\(\)/);
  assert.match(route, /access\.user\.role !== "SUPER_ADMIN"/);
  assert.match(route, /organisationId: access\.station\.organisationId/);
  assert.match(route, /stationId: access\.station\.id/);
  assert.match(route, /encryptSecret\(input\.credential\)/);
  assert.match(route, /createExternalLiveSource\(/);
});
