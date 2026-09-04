import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PLAYOUT_SOURCE_PRIORITIES,
  playoutDecisionEvidence,
  resolveUnifiedPlayout
} from "../lib/playout-resolver.mjs";

const instant = new Date("2026-09-07T08:30:00.000Z");
const window = (minutes = 60) => ({
  validFrom: new Date(instant.getTime() - 60_000),
  validUntil: new Date(instant.getTime() + minutes * 60_000)
});
const candidate = (sourceType, sourceId, overrides = {}) => ({
  sourceType,
  sourceId,
  sourceRevision: `${sourceId}:v1`,
  label: sourceId,
  priority: PLAYOUT_SOURCE_PRIORITIES[sourceType],
  available: true,
  proofClassification: sourceType.includes("AUTODJ") ? "AUTODJ" : "SCHEDULED",
  ...window(),
  ...overrides
});
const resolve = (overrides = {}) => resolveUnifiedPlayout({
  organisationId: "org-1",
  channelId: "channel-1",
  targetId: "player-1",
  instant,
  candidates: [],
  ...overrides
});

test("the unified resolver applies one stable source-priority order", () => {
  const result = resolve({ candidates: [
    candidate("DEFAULT_AUTODJ", "default"),
    candidate("LOCATION_SLOT", "location"),
    candidate("PROGRAMME_SCHEDULE", "breakfast", { priority: PLAYOUT_SOURCE_PRIORITIES.PROGRAMME_SCHEDULE + 90 }),
    candidate("ZONE_SLOT", "zone")
  ] });
  assert.equal(result.sourceType, "PROGRAMME_SCHEDULE");
  assert.equal(result.sourceId, "breakfast");
  assert.deepEqual(result.fallbackChain.map((item) => item.sourceId), ["breakfast", "zone", "location", "default"]);
  assert.equal(result.operatorAlert, null);
});

test("reserved emergency, live and protected school sources retain their precedence", () => {
  const result = resolve({ candidates: [
    candidate("PROGRAMME_SCHEDULE", "programme"),
    candidate("SCHOOL_PROGRAMMING", "school", { proofClassification: "SCHOOL" }),
    candidate("LIVE_SESSION", "studio", { proofClassification: "LIVE" }),
    candidate("EMERGENCY_OVERRIDE", "emergency", { proofClassification: "EMERGENCY" })
  ] });
  assert.deepEqual(result.fallbackChain.map((item) => item.sourceId), ["emergency", "studio", "school", "programme"]);
  assert.equal(result.sourceId, "emergency");
  assert.equal(result.proofClassification, "EMERGENCY");
});

test("an unavailable higher source produces an explainable fallback", () => {
  const result = resolve({ candidates: [
    candidate("PROGRAMME_SCHEDULE", "news", { available: false, unavailableReason: "SOURCE_RIGHTS_UNAVAILABLE" }),
    candidate("DEFAULT_AUTODJ", "default")
  ] });
  assert.equal(result.sourceType, "DEFAULT_AUTODJ");
  assert.equal(result.operatorAlert.code, "PLAYOUT_FALLBACK_ACTIVE");
  assert.deepEqual(result.unavailableReasons, [{ sourceType: "PROGRAMME_SCHEDULE", sourceId: "news", reason: "SOURCE_RIGHTS_UNAVAILABLE" }]);
});

test("required insertions remain ordered and idempotently deduplicated", () => {
  const result = resolve({
    candidates: [candidate("DEFAULT_AUTODJ", "default")],
    requiredInsertions: [
      { scheduleItemId: "school", plannedStart: new Date(instant.getTime() + 20_000) },
      { scheduleItemId: "campaign", plannedStart: new Date(instant.getTime() + 10_000) },
      { scheduleItemId: "school", plannedStart: new Date(instant.getTime() + 20_000) }
    ]
  });
  assert.deepEqual(result.requiredInsertions.map((item) => item.scheduleItemId), ["campaign", "school"]);
  assert.deepEqual(playoutDecisionEvidence(result).requiredInsertionIds, ["campaign", "school"]);
});

test("the same playout context produces the same evidence key", () => {
  const input = { candidates: [candidate("DEFAULT_AUTODJ", "default", { payload: { ignoredByEvidence: Math.random() } })] };
  const first = resolve(input);
  const second = resolve(input);
  assert.match(first.decisionKey, /^[0-9a-f]{64}$/);
  assert.equal(first.decisionKey, second.decisionKey);
  const changed = resolve({ candidates: [candidate("BACKUP_AUTODJ", "backup")] });
  assert.notEqual(first.decisionKey, changed.decisionKey);
  const fallbackChanged = resolve({ candidates: [
    candidate("PROGRAMME_SCHEDULE", "programme", { available: false, unavailableReason: "RIGHTS_UNAVAILABLE" }),
    candidate("DEFAULT_AUTODJ", "default")
  ] });
  assert.notEqual(first.decisionKey, fallbackChanged.decisionKey);
});

test("tenant and channel boundaries fail closed", () => {
  assert.throws(() => resolve({ candidates: [candidate("DEFAULT_AUTODJ", "foreign", { organisationId: "org-2" })] }), /another organisation/i);
  assert.throws(() => resolve({ candidates: [candidate("DEFAULT_AUTODJ", "foreign-channel", { channelId: "channel-2" })] }), /another channel/i);
});

test("no playable source becomes a bounded critical decision", () => {
  const result = resolve({ candidates: [candidate("DEFAULT_AUTODJ", "default", { available: false, unavailableReason: "NO_PLAYABLE_TRACKS" })] });
  assert.equal(result.sourceType, "CRITICAL_FAILURE");
  assert.equal(result.proofClassification, "CRITICAL_FAILURE");
  assert.equal(result.operatorAlert.severity, "CRITICAL");
  assert.equal(result.nextDecisionAt.toISOString(), "2026-09-07T08:35:00.000Z");
});

test("large candidate sets resolve within the player request budget", () => {
  const candidates = Array.from({ length: 10_000 }, (_, index) => candidate(
    index === 9999 ? "PROGRAMME_SCHEDULE" : "DEFAULT_AUTODJ",
    `source-${String(index).padStart(5, "0")}`,
    { priority: index === 9999 ? 900 : 400 }
  ));
  const startedAt = performance.now();
  const result = resolve({ candidates });
  const elapsed = performance.now() - startedAt;
  assert.equal(result.sourceId, "source-09999");
  assert.ok(elapsed < 1000, `Resolver took ${elapsed.toFixed(1)} ms`);
});

test("the player routes keep unified decisions tenant-bound, signed and documented", async () => {
  const [programming, manifestRoute, manifest, proofRoute, roadmap] = await Promise.all([
    readFile(new URL("../lib/player-programming.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/player/manifest/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/player-manifest.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/player/proof-of-play/route.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-online-radio-index.md", import.meta.url), "utf8")
  ]);
  assert.match(programming, /where: \{ organisationId: player\.organisationId, channelId \}/);
  assert.match(programming, /resolveUnifiedPlayout\(\{/);
  assert.match(manifestRoute, /playoutDecision/);
  assert.match(manifest, /playoutDecisionEvidence/);
  assert.doesNotMatch(manifest, /selectedPayload/);
  assert.match(proofRoute, /PROGRAMME_SHOW_RUNDOWN/);
  assert.match(roadmap, /19\.6 \| Unified Playout Engine \| DEPLOYED/);
});
