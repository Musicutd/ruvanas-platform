import assert from "node:assert/strict";
import { test } from "node:test";
import { retailTestPlayerBootstrapRequest as bootstrap, retailTestPlayerDeviceRequest as device } from "../lib/retail-test-player-request.mjs";

test("only code-entry shell and compiled client assets are public bootstrap reads", () => {
  for (const method of ["GET", "HEAD"]) {
    assert.equal(bootstrap("/player", method), true);
    assert.equal(bootstrap("/_next/static/chunks/app/player/page-a12.js", method), true);
  }
  for (const path of ["/player/extra", "/api/player/state", "/api/player/media/a", "/api/player/proof-of-play", "/api/auth/register",
    "/admin", "/dashboard", "/assets/private.json", "/_next/static/../secrets", "/_next/static/%2e%2e/file", "/_next/static/app.js.map"]) {
    assert.equal(bootstrap(path, "GET"), false, path);
    assert.equal(bootstrap(path, "POST"), false, path);
  }
  assert.equal(bootstrap("/api/player/enrol", "POST"), true);
  assert.equal(bootstrap("/api/player/enrol", "GET"), false);
  assert.equal(bootstrap("/player", "POST"), false);
});

test("device cookie can only reach separately authenticated stream routes", () => {
  for (const path of ["/api/player/state", "/api/player/manifest"]) assert.equal(device(path, "GET"), true);
  for (const method of ["POST", "DELETE"]) assert.equal(device("/api/player/heartbeat", method), true);
  assert.equal(device("/api/player/stream-evidence", "POST"), true);
  for (const path of ["/api/player/media/a", "/api/player/live/a", "/api/player/proof-of-play", "/api/player/commands",
    "/api/player/commands/a/acknowledge", "/api/admin/private-preview/testers", "/api/account/test-tier", "/api/player/heartbeat/extra"]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.equal(device(path, method), false, path);
  }
});
