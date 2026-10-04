import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lockVisibleNewsroomStory } from "../lib/newsroom-write-boundary.mjs";

test("School Newsroom locks current, historical, incoming and episode sources before its final privacy check", async () => {
  const calls = [];
  let storyReads = 0;
  const tx = {
    async $queryRaw(parts, ...values) {
      calls.push({ sql: parts.join("?"), values });
      return [{ id: "locked" }];
    },
    schoolNewsStory: { async findFirst(query) {
      storyReads += 1;
      if (storyReads === 1) return {
        episodeId: "episode", stationId: null, audioProjectId: "project-current",
        interviewMediaAssetId: "media-current", revisions: [{ audioProjectId: "project-old", interviewMediaAssetId: "media-old" }]
      };
      calls.push({ finalWhere: query.where });
      return { id: "story" };
    } },
    schoolRundown: { async findFirst() { return { id: "rundown" }; } },
    schoolRundownItem: { async findMany() {
      return [{ sourceMediaAssetId: "media-rundown", sourceTrack: null,
        sourcePromoVersion: null, sourceAnnouncement: null,
        sourceTake: { projectId: "project-take", mediaAssetId: "media-take" } }];
    } }
  };
  const visibleWhere = { AND: [{ revisions: { every: {} } }] };
  const story = await lockVisibleNewsroomStory(tx, {
    organisationId: "org", storyId: "story", product: "SCHOOL_RADIO", visibleWhere,
    additionalMediaAssetId: "media-incoming"
  });
  assert.equal(story.id, "story");
  const lockedTables = calls.filter((call) => call.sql).map((call) => call.sql.match(/FROM "([^"]+)"/)?.[1]);
  assert.deepEqual(lockedTables.slice(0, 4), ["SchoolNewsStory", "SchoolEpisode", "SchoolRundown", "SchoolRundownItem"]);
  assert.deepEqual(calls.filter((call) => call.sql?.includes('FROM "AudioProject"')).map((call) => call.values[0]),
    ["project-current", "project-old", "project-take"]);
  assert.deepEqual(calls.filter((call) => call.sql?.includes('FROM "MediaAsset"')).map((call) => call.values[0]),
    ["media-current", "media-incoming", "media-old", "media-rundown", "media-take"]);
  assert.deepEqual(calls.at(-1).finalWhere, { id: "story", organisationId: "org", product: "SCHOOL_RADIO", ...visibleWhere });
});

test("Online Newsroom locks its station channels and proposed sources before review", async () => {
  const calls = [];
  let storyReads = 0;
  const tx = {
    async $queryRaw(parts, ...values) { calls.push({ sql: parts.join("?"), values }); return [{ id: "locked" }]; },
    schoolNewsStory: { async findFirst(query) {
      storyReads += 1;
      if (storyReads === 1) return { stationId: "station", episodeId: null,
        audioProjectId: null, interviewMediaAssetId: null, revisions: [] };
      calls.push({ finalWhere: query.where });
      return { id: "story" };
    } }
  };
  await lockVisibleNewsroomStory(tx, { organisationId: "org", storyId: "story", product: "ONLINE_RADIO",
    visibleWhere: { AND: [{ status: "APPROVED" }] }, additionalProjectId: "project", additionalMediaAssetId: "media" });
  assert.deepEqual(calls.filter((call) => call.sql).map((call) => call.sql.match(/FROM "([^"]+)"/)?.[1]),
    ["SchoolNewsStory", "Station", "Channel", "AudioProject", "MediaAsset"]);
  assert.equal(calls.at(-1).finalWhere.AND[0].status, "APPROVED");
});

test("both Newsroom routes recheck locked story state and proposed SAVE audio within the write transaction", async () => {
  const [school, online, schoolUi] = await Promise.all([
    readFile(new URL("../app/api/school-radio/newsroom/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/newsroom/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/PodcastNewsLiveClient.js", import.meta.url), "utf8")
  ]);
  for (const route of [school, online]) {
    assert.equal((route.match(/lockVisibleNewsroomStory\(tx,/g) || []).length, 2 + Number(route === online));
    assert.match(route, /currentStatus: current\.status/);
    assert.match(route, /assignedToUserId: current\.assignedToUserId/);
    assert.match(route, /IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED/);
  }
  assert.match(school, /additionalMediaAssetId: data\.interviewMediaAssetId[\s\S]*tx\.mediaAsset\.findFirst/);
  assert.match(online, /additionalProjectId: data\.audioProjectId, additionalMediaAssetId: data\.interviewMediaAssetId[\s\S]*currentProject, currentAsset/);
  assert.match(schoolUi, /readOnly=\{reviewed\}/);
  assert.match(schoolUi, /disabled=\{working \|\| reviewed\}/);
});
