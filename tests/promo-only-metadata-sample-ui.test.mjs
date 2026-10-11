import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

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
  assert.match(consolePage, /Metadata inspection only\. No audio or playback rights are granted/);
  assert.match(consolePage, /disabled=\{Boolean\(busy\) \|\| metadataSampleReady\}/);
  assert.match(consolePage, /disabled=\{Boolean\(busy\) \|\| !config\.enabled \|\| !config\.rssConfigured\}/);
});
