import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const page = await readFile(new URL("../app/admin/promo-only/page.js", import.meta.url), "utf8");
const consolePage = await readFile(new URL("../app/admin/promo-only/PromoOnlyConsole.js", import.meta.url), "utf8");

test("metadata sample readiness alone crosses the server/client boundary", () => {
  assert.match(page, /metadataSampleReady = readPromoOnlyMetadataSampleConfig\(\)\.ready === true/);
  assert.match(page, /initial=\{serializable\(\{ config, configError, metadataSampleReady,/);
  assert.match(page, /safePromoOnlyConfig\(readPromoOnlyConfig\(\)\)/);
  assert.doesNotMatch(page, /serializable\([^\n]*(?:sampleConfig|apiKey|apiSecret|userId)/);
  assert.match(page, /user\.role !== "SUPER_ADMIN"/);
});

test("one-sample control is gated and cannot silently become a full sync or audio import", () => {
  assert.match(consolePage, /metadataSampleReady = false/);
  assert.match(consolePage, /metadataSampleReady \? <>/);
  assert.match(consolePage, /post\("\/api\/admin\/promo-only\/metadata-sample"\)/);
  assert.match(consolePage, /Import one metadata sample/);
  assert.match(consolePage, /No audio was downloaded or made playable; this is not a full library sync/);
  assert.match(consolePage, /Metadata inspection only\. No public audio or playback rights are granted/);
  assert.match(consolePage, /disabled=\{Boolean\(busy\) \|\| metadataSampleReady\}/);
  assert.match(consolePage, /disabled=\{syncDisabled\}/);
  assert.match(consolePage, /const syncDisabled = Boolean\(busy\) \|\| syncUnavailable/);
});

const statusLogic = consolePage.match(/  const syncUnavailableReasons = \[[\s\S]+?  const syncDisabled = [^\n]+;/)?.[0];
function syncStatus(config, busy = "") {
  assert.ok(statusLogic, "The tested status logic must be the component's actual declarations.");
  return JSON.parse(runInNewContext(`${statusLogic}\nJSON.stringify({ syncUnavailableReasons, syncUnavailable, syncDisabled });`, { config, busy }));
}

test("disabled sync explains both OFF mode and missing feed without treating credentials as readiness", () => {
  const status = syncStatus({ enabled: false, mode: "OFF", rssConfigured: false, credentialsConfigured: true });
  assert.equal(status.syncDisabled, true);
  assert.equal(status.syncUnavailable, true);
  assert.equal(status.syncUnavailableReasons.length, 2);
  assert.match(status.syncUnavailableReasons[0], /switched off/);
  assert.match(status.syncUnavailableReasons[1], /feed \(RSS\)/);
  assert.match(consolePage, /aria-describedby=\{syncUnavailable \? "promo-only-sync-unavailable" : undefined\}/);
  assert.match(consolePage, /id="promo-only-sync-unavailable" role="note"/);
  assert.match(consolePage, /opacity: syncDisabled \? 0\.55 : 1, cursor: syncDisabled \? "not-allowed" : "pointer"/);
  assert.match(consolePage, /API credentials alone do not enable full catalogue sync/);
  assert.match(consolePage, /paused — no automatic sync is running/);
  assert.doesNotMatch(consolePage, /useEffect|setInterval|setTimeout/);
});

test("missing feed and explicit OFF mode each independently disable sync", () => {
  assert.deepEqual(syncStatus({ enabled: true, mode: "METADATA", rssConfigured: false }).syncUnavailableReasons,
    ["No approved Promo Only catalogue feed (RSS) is configured."]);
  assert.deepEqual(syncStatus({ enabled: true, mode: "OFF", rssConfigured: true }).syncUnavailableReasons,
    ["Catalogue sync is switched off for this private preview."]);
});

test("configured sync is available only when idle and reports working only for its own action", () => {
  const config = { enabled: true, mode: "METADATA", rssConfigured: true };
  assert.equal(syncStatus(config).syncDisabled, false);
  assert.equal(syncStatus(config, "/api/admin/promo-only/metadata-sample").syncDisabled, true);
  assert.equal(syncStatus(config).syncUnavailable, false);
  assert.match(consolePage, /busy === "\/api\/admin\/promo-only\/sync" \? "Syncing…" : "Run Sync Now"/);
});
