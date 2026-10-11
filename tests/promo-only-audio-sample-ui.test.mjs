import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(new URL("../app/admin/promo-only/page.js", import.meta.url), "utf8");
const consolePage = await readFile(new URL("../app/admin/promo-only/PromoOnlyConsole.js", import.meta.url), "utf8");

test("private audio sample status is owner-code-only and contains no configuration object", () => {
  assert.match(page, /session\?\.authMethod === "PREVIEW_CODE" && isPrivatePreviewAdmin\(session\.user, policy\)/);
  assert.match(page, /getPromoOnlyAudioSampleState\(prisma, \{ actorUserId: session\.userId, config: audioConfig \}\)/);
  assert.match(page, /metadataSampleReady, audioSampleState, connection/);
  assert.doesNotMatch(page, /serializable\([^\n]*(?:audioConfig|apiKey|apiSecret|R2_SECRET|downloadToken)/);
});

test("one named sample uses a separate no-input action and authenticated lazy player", () => {
  assert.match(consolePage, /audioSampleState\?\.enabled \?/);
  assert.match(consolePage, /track 713637 · release 122500/);
  assert.match(consolePage, /audioSampleState\.canImport \? <button/);
  assert.match(consolePage, /post\("\/api\/admin\/promo-only\/audio-sample"\)/);
  assert.match(consolePage, /audioSampleState\.playbackAvailable \? <>/);
  assert.match(consolePage, /<audio[^>]*controls preload="none"[^>]*src="\/api\/admin\/promo-only\/audio-sample\/stream"/);
  assert.doesNotMatch(consolePage, /autoPlay|r2\.dev|cloudflarestorage\.com|downloadToken/);
  assert.match(consolePage, /public access and AutoDJ remain off/);
  assert.match(consolePage, /Do not repeat the download/);
});
