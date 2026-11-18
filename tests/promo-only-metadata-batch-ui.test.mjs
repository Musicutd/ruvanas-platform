import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const route = await readFile(new URL("app/api/admin/promo-only/metadata-batch/route.js", root), "utf8");
const page = await readFile(new URL("app/admin/promo-only/page.js", root), "utf8");
const ui = await readFile(new URL("app/admin/promo-only/PromoOnlyConsole.js", root), "utf8");

test("batch route retains exact-origin, password-preview owner, no-input and persistent actor limit gates", () => {
  assert.match(route, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(route, /if \(!isPrivatePreviewAdminSession\(session, policy\)\)/);
  assert.match(route, /new URL\(request\.url\)\.search/);
  assert.match(route, /sampleRequestBodyIsEmpty\(request\)/);
  assert.match(route, /limit: 2, windowMs: HOUR_MS/);
  assert.match(route, /promo-only-metadata-batch:\$\{actorHash\}/);
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.doesNotMatch(route, /export async function (?:GET|PATCH|PUT)|runPromoOnlySync|queueDownload|request\.json\(/);
  const gate = route.indexOf('if (!config.enabled || !config.ready)');
  assert.ok(gate > 0 && gate < route.indexOf("await consumeRateLimit"));
  assert.ok(route.indexOf("await consumeRateLimit") < route.indexOf("await runPromoOnlyMetadataBatch"));
});

test("only owner readiness and safe stored counts cross the page boundary", () => {
  assert.match(page, /metadataBatchReady = isPrivatePreviewAdminSession\(session, policy\)/);
  assert.match(page, /readPromoOnlyMetadataBatchConfig\(\)\.ready === true/);
  assert.match(page, /serializable\(\{ config, configError, metadataSampleReady, audioSampleState, connection,[^\n]+metadataBatchReady \}\)/);
  assert.doesNotMatch(page, /serializable\([^\n]*(?:batchConfig|apiKey|apiSecret)/);
  for (const name of ["createdCount", "updatedCount", "unchangedCount"]) assert.match(page, new RegExp(`${name}: true`));
});

test("explicit batch button explains its limit, preserves OFF feed sync and does not auto-run", () => {
  assert.match(ui, /metadataBatchReady = false/);
  assert.match(ui, /metadataBatchReady \? <>/);
  assert.match(ui, /post\("\/api\/admin\/promo-only\/metadata-batch"\)/);
  assert.match(ui, /Import one release \(max 25 tracks\)/);
  assert.match(ui, /RSS is not needed for this action/);
  assert.match(ui, /existing queued or imported audio is left untouched/);
  assert.match(ui, /No audio was downloaded or made playable\. Automatic sync remains off/);
  assert.match(ui, /disabled=\{syncDisabled\}/);
  assert.match(ui, /RSS is required by this feed-sync button, not by the manual API metadata import/);
  assert.doesNotMatch(ui, /useEffect|setInterval|setTimeout/);
});
