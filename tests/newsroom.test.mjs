import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  NEWSROOM_PRODUCTS,
  canEditNewsStory,
  normalizeNewsSources,
  newsroomSourceFingerprint,
  transitionNewsStory
} from "../lib/newsroom.mjs";

test("newsroom sources are bounded, safe and de-duplicated", () => {
  const sources = normalizeNewsSources([
    { label: "Council notice", url: "https://example.test/notice", notes: "Checked at source" },
    { label: "Council notice", url: "https://example.test/notice", notes: "Duplicate" }
  ]);
  assert.equal(sources.length, 1);
  assert.equal(newsroomSourceFingerprint(sources).length, 64);
  assert.throws(() => normalizeNewsSources([{ label: "Unsafe", url: "file:///private/story" }]), /HTTP or HTTPS/);
  assert.throws(() => normalizeNewsSources(Array.from({ length: 51 }, (_, index) => ({ label: `Source ${index}` }))), /no more than 50/);
});

test("content editors cannot change a story assigned to another person", () => {
  assert.equal(canEditNewsStory({ role: "CONTENT_EDITOR", userId: "user-1", assignedToUserId: "user-1" }), true);
  assert.equal(canEditNewsStory({ role: "CONTENT_EDITOR", userId: "user-1", assignedToUserId: "user-2" }), false);
  assert.equal(canEditNewsStory({ role: "MANAGER", userId: "manager", assignedToUserId: "user-2" }), true);
  assert.equal(canEditNewsStory({ role: "VIEWER", userId: "viewer", assignedToUserId: null }), false);
});

test("Online Radio newsroom enforces source, fact-check and production gates", () => {
  assert.throws(() => transitionNewsStory({ currentStatus: "SCRIPTING", action: "FACT_CHECK", product: NEWSROOM_PRODUCTS.ONLINE_RADIO, hasScript: true }), /at least one recorded source/);
  assert.equal(transitionNewsStory({ currentStatus: "SCRIPTING", action: "FACT_CHECK", product: NEWSROOM_PRODUCTS.ONLINE_RADIO, hasScript: true, hasSources: true }).status, "FACT_CHECK");
  assert.throws(() => transitionNewsStory({ currentStatus: "FACT_CHECK", action: "START_AUDIO", product: NEWSROOM_PRODUCTS.ONLINE_RADIO }), /fact-check notes/);
  assert.throws(() => transitionNewsStory({ currentStatus: "AUDIO_PRODUCTION", action: "SUBMIT", product: NEWSROOM_PRODUCTS.ONLINE_RADIO }), /Studio project or interview recording/);
  assert.equal(transitionNewsStory({ currentStatus: "AUDIO_PRODUCTION", action: "SUBMIT", product: NEWSROOM_PRODUCTS.ONLINE_RADIO, hasProductionAsset: true }).status, "IN_REVIEW");
});

test("manager approval retains interview consent and completeness controls", () => {
  const complete = { currentStatus: "IN_REVIEW", action: "APPROVE", product: NEWSROOM_PRODUCTS.ONLINE_RADIO, hasScript: true, hasFactCheck: true, hasSources: true, hasProductionAsset: true };
  assert.equal(transitionNewsStory(complete).status, "APPROVED");
  assert.throws(() => transitionNewsStory({ ...complete, hasInterviewAsset: true }), /interview consent/);
  assert.equal(transitionNewsStory({ ...complete, hasInterviewAsset: true, interviewConsentConfirmed: true }).status, "APPROVED");
  assert.throws(() => transitionNewsStory({ currentStatus: "IN_REVIEW", action: "REQUEST_CHANGES", product: NEWSROOM_PRODUCTS.ONLINE_RADIO }), /feedback/);
});

test("Stage 19.25 isolates products and preserves immutable editorial evidence", async () => {
  const [route, schoolRoute, schema, migration, page, navigation, docs] = await Promise.all([
    readFile(new URL("../app/api/newsroom/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/newsroom/route.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261026000000_stage_19_25_newsroom/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/newsroom/NewsroomWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-25-newsroom.md", import.meta.url), "utf8")
  ]);
  assert.match(route, /requireActiveNewsroom\(ORGANISATION_CONTENT_ROLES\)/);
  assert.match(route, /product: NEWSROOM_PRODUCTS\.ONLINE_RADIO/);
  assert.match(route, /stationId: data\.stationId, organisationId/);
  assert.match(route, /newsStoryRevision\.create/);
  assert.match(route, /newsStoryDecision\.create/);
  assert.match(route, /liveScheduleChanged: false/);
  assert.doesNotMatch(route, /PROGRAMME_SCHEDULE_VERSION_PUBLISHED/);
  assert.match(schoolRoute, /product: NEWSROOM_PRODUCTS\.SCHOOL_RADIO/);
  assert.match(schema, /enum NewsroomProduct/);
  assert.match(schema, /@@unique\(\[id, organisationId\]\)/);
  assert.match(schema, /model NewsStoryRevision/);
  assert.match(schema, /model NewsStoryDecision/);
  assert.match(migration, /FOREIGN KEY \("channelId", "stationId", "organisationId"\)/);
  assert.match(migration, /NewsStoryRevision_interviewMediaAssetId_organisationId_fkey/);
  assert.match(page, /Open Ruvanas Studio/);
  assert.match(page, /Request changes/);
  assert.match(navigation, /label: "Newsroom"/);
  assert.match(docs, /does not insert content into a schedule/);
});

test("newsroom listing remains explicitly bounded and indexed", async () => {
  const [route, schema] = await Promise.all([
    readFile(new URL("../app/api/newsroom/route.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
  ]);
  assert.match(route, /take: 200/);
  assert.match(schema, /@@index\(\[organisationId, product, status, deadline\]\)/);
  const sample = Array.from({ length: 50 }, (_, index) => ({ label: `Source ${index}`, url: `https:\/\/example.test\/${index}` }));
  const started = performance.now();
  for (let index = 0; index < 100; index += 1) normalizeNewsSources(sample);
  assert.ok(performance.now() - started < 1000);
});
