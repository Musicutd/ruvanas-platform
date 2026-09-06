import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildProgrammeDirectorPlan,
  canRequestProgrammeDirector,
  canReviewProgrammeDirector,
  normalizeProgrammeDirectorRequest,
  programmeDirectorDraftText,
  programmeDirectorPlanForSchedule,
  programmeDirectorProvenance
} from "../lib/ai-programme-director.mjs";

const request = {
  channelId: "channel-1",
  fallbackMusicModeId: "mode-1",
  objective: "CONTINUITY",
  title: "Weekly continuity",
  brief: "Keep the station covered while retaining the approved breakfast programme.",
  timezone: "Europe/Malta"
};

const channel = { id: "channel-1", name: "Main Radio", station: { name: "Ruvanas FM" } };
const fallbackMusicMode = { id: "mode-1", name: "Daytime Rotation" };

test("Programme Director access separates authors from human approvers", () => {
  assert.equal(canRequestProgrammeDirector("CONTENT_EDITOR"), true);
  assert.equal(canReviewProgrammeDirector("CONTENT_EDITOR"), false);
  assert.equal(canReviewProgrammeDirector("MANAGER"), true);
  assert.equal(canRequestProgrammeDirector("VIEWER"), false);
});

test("Programme Director requests are bounded and require a real timezone", () => {
  assert.equal(normalizeProgrammeDirectorRequest(request).objective, "CONTINUITY");
  assert.throws(() => normalizeProgrammeDirectorRequest({ ...request, objective: "AUTO_PUBLISH" }), /supported programme objective/);
  assert.throws(() => normalizeProgrammeDirectorRequest({ ...request, timezone: "Tomorrow/Somewhere" }), /valid IANA timezone/);
  assert.throws(() => normalizeProgrammeDirectorRequest({ ...request, brief: "short" }), /Programming brief/);
});

test("a new channel receives seven low-priority continuity items", () => {
  const plan = buildProgrammeDirectorPlan({ request, channel, fallbackMusicMode });
  assert.equal(plan.items.length, 7);
  assert.deepEqual(plan.items.map((item) => item.weekday), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(plan.items.every((item) => item.durationMinutes === 1440 && item.priority === 0 && item.sourceId === "mode-1"));
  assert.equal(plan.controls.autoPublishAllowed, false);
  assert.equal(plan.controls.privateDataSent, false);
});

test("existing programmes are retained above the continuity layer", () => {
  const schedule = {
    id: "schedule-1",
    name: "Main schedule",
    timezone: "Europe/Malta",
    versions: [{
      id: "version-3",
      version: 3,
      items: [{ label: "Breakfast", recurrence: "WEEKLY", sourceType: "RADIO_CLOCK", weekday: 1, startTime: "07:00", startsAt: null, durationMinutes: 60, priority: 0, sourceId: "clock-1" }]
    }]
  };
  const plan = buildProgrammeDirectorPlan({ request, channel, fallbackMusicMode, schedule });
  assert.equal(plan.baselineVersionId, "version-3");
  assert.equal(plan.items.length, 8);
  assert.equal(plan.items.at(-1).label, "Breakfast");
  assert.equal(plan.items.at(-1).priority, 10);
  const scheduleInput = programmeDirectorPlanForSchedule(plan);
  assert.equal(scheduleInput.items.length, 8);
  assert.equal("position" in scheduleInput.items[0], false);
});

test("recommendations disclose evidence, data boundary and absence of live changes", () => {
  const plan = buildProgrammeDirectorPlan({ request, channel, fallbackMusicMode });
  const draft = programmeDirectorDraftText(plan);
  const provenance = programmeDirectorProvenance(plan);
  assert.match(draft, /No listener identity, student data, raw audio or provider credential was shared/);
  assert.match(draft, /Approval does not change live radio/);
  assert.equal(provenance.humanReviewRequired, true);
  assert.equal(provenance.externalProviderUsed, false);
  assert.equal(provenance.autoPublishAllowed, false);
});

test("schedule conversion refuses a recommendation without governance controls", () => {
  assert.throws(() => programmeDirectorPlanForSchedule({ controls: { humanReviewRequired: false } }), /governed review controls/);
});

test("Stage 19.24 preserves tenant review, stale-baseline and draft-only boundaries", async () => {
  const [route, reviewRoute, applyRoute, schema, migration, page, navigation, docs] = await Promise.all([
    readFile(new URL("../app/api/programming/programme-director/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/programme-director/[jobId]/review/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/programme-director/[jobId]/apply/route.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261025000000_stage_19_24_ai_programme_director/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/programme-director/ProgrammeDirectorWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-24-ai-programme-director.md", import.meta.url), "utf8")
  ]);
  assert.match(route, /organisationId = membership\.organisationId/);
  assert.match(route, /RUVANAS_PROGRAMME_RULES_V1/);
  assert.match(route, /PROGRAMME_DIRECTOR_DAILY_LIMIT/);
  assert.match(reviewRoute, /canReviewProgrammeDirector/);
  assert.match(applyRoute, /baselineVersionId/);
  assert.match(applyRoute, /liveScheduleChanged: false/);
  assert.doesNotMatch(applyRoute, /PROGRAMME_SCHEDULE_VERSION_PUBLISHED/);
  assert.match(schema, /PROGRAMME_DIRECTOR/);
  assert.match(migration, /ADD VALUE 'PROGRAMME_DIRECTOR'/);
  assert.match(page, /Create schedule draft/);
  assert.match(navigation, /AI Programme Director/);
  assert.match(docs, /has no publish operation/);
});
