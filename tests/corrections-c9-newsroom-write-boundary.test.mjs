import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lockVisibleNewsroomStory, lockVisibleOnlineNewsroomCreateTargets, lockVisibleSchoolNewsroomCreateTargets } from "../lib/newsroom-write-boundary.mjs";

function mediaSource(id, associations = {}) {
  return {
    id, organisationId: "org", libraryType: "ORGANISATION_PROMO",
    audioTakes: [], audioRenderOutputs: [], promoVersions: [], audioClips: [], ...associations
  };
}

test("Newsroom CREATE locks current targets before checking their privacy", async () => {
  const calls = [];
  const tx = {
    async $queryRaw(parts) { calls.push(parts.join("?")); return [{ id: "locked" }]; },
    station: { async findFirst() { calls.push("station-check"); return { id: "station" }; } },
    channel: { async findFirst() { calls.push("channel-check"); return { id: "channel" }; } },
    schoolProgramme: { async findFirst() { calls.push("programme-check"); return { id: "programme" }; } },
    schoolEpisode: { async findFirst() { calls.push("episode-check"); return { id: "episode" }; } },
    schoolRundown: { async findFirst() { return null; } }
  };
  assert.equal(await lockVisibleOnlineNewsroomCreateTargets(tx, {
    organisationId: "org", stationId: "station", channelId: "channel",
    stationWhere: { productFamily: { not: "CORRECTIONS" } }, channelWhere: { musicRightsUse: { not: "CORRECTIONS_RADIO" } }
  }), true);
  assert.deepEqual(calls.slice(0, 4).map((call) => call.match(/FROM "([^"]+)"/)?.[1] || call),
    ["Station", "Channel", "station-check", "channel-check"]);
  calls.length = 0;
  assert.equal(await lockVisibleSchoolNewsroomCreateTargets(tx, {
    organisationId: "org", programmeId: "programme", episodeId: "episode"
  }), true);
  assert.deepEqual(calls.map((call) => call.match(/FROM "([^"]+)"/)?.[1] || call),
    ["SchoolProgramme", "programme-check", "SchoolEpisode", "episode-check"]);
});

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
    } },
    mediaAsset: { async findMany(query) {
      return query.where.id.in.map((id) => mediaSource(id, id === "media-current" ? {
        audioRenderOutputs: [{ projectId: "project-render" }]
      } : id === "media-old" ? {
        promoVersions: [{ id: "promo-old", mediaAssetId: id, renderedAudioVersions: [{ projectId: "project-promo" }] }]
      } : id === "media-incoming" ? {
        audioClips: [{ track: { projectId: "project-clip" } }]
      } : {}));
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
    ["project-current", "project-old", "project-take", "project-clip", "project-promo", "project-render"]);
  assert.deepEqual(calls.filter((call) => call.sql?.includes('FROM "MediaAsset"')).map((call) => call.values[0]),
    ["media-current", "media-incoming", "media-old", "media-rundown", "media-take"]);
  assert.deepEqual(calls.filter((call) => call.sql?.includes('FROM "PromoVersion"')).map((call) => call.values[0]), ["promo-old"]);
  const sourceTables = lockedTables.slice(4);
  assert.ok(sourceTables.lastIndexOf("AudioProject") < sourceTables.indexOf("MediaAsset"));
  assert.ok(sourceTables.lastIndexOf("MediaAsset") < sourceTables.indexOf("PromoVersion"));
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
    } },
    mediaAsset: { async findMany(query) {
      return query.where.id.in.map((id) => mediaSource(id, { audioTakes: [{ projectId: "project-media" }] }));
    } }
  };
  await lockVisibleNewsroomStory(tx, { organisationId: "org", storyId: "story", product: "ONLINE_RADIO",
    visibleWhere: { AND: [{ status: "APPROVED" }] }, additionalProjectId: "project", additionalMediaAssetId: "media" });
  assert.deepEqual(calls.filter((call) => call.sql).map((call) => call.sql.match(/FROM "([^"]+)"/)?.[1]),
    ["SchoolNewsStory", "Station", "Channel", "AudioProject", "AudioProject", "MediaAsset"]);
  assert.deepEqual(calls.filter((call) => call.sql?.includes('FROM "AudioProject"')).map((call) => call.values[0]),
    ["project", "project-media"]);
  assert.equal(calls.at(-1).finalWhere.AND[0].status, "APPROVED");
});

test("Newsroom maps a newly private media-only source to an unavailable current story", async () => {
  let storyReads = 0;
  const tx = {
    async $queryRaw() { return [{ id: "locked" }]; },
    schoolNewsStory: { async findFirst() {
      storyReads += 1;
      return { stationId: null, episodeId: null, audioProjectId: null,
        interviewMediaAssetId: "media-private", revisions: [] };
    } },
    mediaAsset: { async findMany(query) {
      // Source discovery and refresh still find the asset; its final ordinary
      // privacy predicate fails after the competing submission commits.
      return query.select.audioTakes ? [mediaSource("media-private", {
        audioRenderOutputs: [{ projectId: "project-private" }]
      })] : [];
    } }
  };
  assert.equal(await lockVisibleNewsroomStory(tx, {
    organisationId: "org", storyId: "story", product: "SCHOOL_RADIO", visibleWhere: {}, include: {}
  }), null);
  assert.equal(storyReads, 1, "Private media must not reach the final story read or subsequent caller writes.");
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
  assert.match(school, /lockVisibleSchoolNewsroomCreateTargets\(tx,[\s\S]*tx\.schoolNewsStory\.create/);
  assert.match(online, /lockVisibleOnlineNewsroomCreateTargets\(tx,[\s\S]*tx\.schoolNewsStory\.create/);
});
