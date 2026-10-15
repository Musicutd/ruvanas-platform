import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(new URL("../app/admin/promo-only/page.js", import.meta.url), "utf8");
const consolePage = await readFile(new URL("../app/admin/promo-only/PromoOnlyConsole.js", import.meta.url), "utf8");

test("private audio sample status is password-preview-owner-only and contains no configuration object", () => {
  assert.match(page, /audioConfig\.enabled && isPrivatePreviewAdminSession\(session, policy\)/);
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

test("pre-download repair is a separate explicit no-input action for the named failure only", () => {
  assert.match(consolePage, /audioSampleState\.ready && audioSampleState\.reconciliationRequired && audioSampleState\.safeErrorCode === "PROMOONLY_AUDIO_SAMPLE_SERVERS_INVALID"/);
  assert.match(consolePage, /post\("\/api\/admin\/promo-only\/audio-sample\/preflight-repair"\)/);
  assert.match(consolePage, /This check cannot queue or download audio/);
  assert.match(consolePage, /payload\.result\?\.repaired === true/);
  assert.match(consolePage, /Pre-download check repaired\. No audio was downloaded/);
  assert.match(consolePage, /if \(path === "\/api\/admin\/promo-only\/audio-sample" \|\| path === "\/api\/admin\/promo-only\/audio-sample\/preflight-repair" \|\| path === "\/api\/admin\/promo-only\/audio-sample\/recover"\) router\.refresh\(\)/);
  assert.doesNotMatch(consolePage, /useEffect|setInterval|setTimeout/);
});

test("existing queue recovery needs server-authorised state and explicit separate no-input action", () => {
  assert.match(consolePage, /audioSampleState\.canRecover === true \? <>/);
  assert.match(consolePage, /post\("\/api\/admin\/promo-only\/audio-sample\/recover"\)/);
  assert.match(consolePage, /This action cannot queue a track again/);
  assert.match(consolePage, /A failed recovery stays locked/);
  assert.match(consolePage, /No new queue request was made/);
  assert.doesNotMatch(consolePage, /useEffect|setInterval|setTimeout|autoPlay/);
});
