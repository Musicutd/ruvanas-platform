import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generalSchoolNewsStoryWhere, generalSchoolRundownWhere } from "../lib/school-general-content-boundary.mjs";

test("School rundown privacy predicate checks every historical source, including School music rights", () => {
  const conditions = generalSchoolRundownWhere("school-org").items.every.AND;
  assert.equal(conditions.length, 5);
  assert.equal(conditions[0].OR[1].sourceMediaAsset.is.organisationId, "school-org");
  assert.equal(conditions[1].OR[1].sourceTrack.is.permittedUses.has, "SCHOOL_RADIO");
  assert.equal(conditions[1].OR[1].sourceTrack.is.isExplicit, false);
  assert.equal(conditions[3].OR[1].sourceAnnouncement.is.organisationId, "school-org");
  assert.equal(conditions[4].OR[1].sourceTake.is.project.is.organisationId, "school-org");
});

test("School newsroom privacy predicate covers current and historical revision links", () => {
  const conditions = generalSchoolNewsStoryWhere("school-org").AND;
  assert.equal(conditions[0].OR[1].audioProject.is.organisationId, "school-org");
  assert.equal(conditions[1].OR[1].interviewMediaAsset.is.organisationId, "school-org");
  assert.deepEqual(conditions[5].revisions.every.AND, conditions.slice(0, 2));
});

test("School Show Builder rechecks private sources for selectors, mutations and historical rundowns", async () => {
  const route = await readFile(new URL("../app/api/school-radio/show-builder/route.js", import.meta.url), "utf8");
  assert.match(route, /schoolEpisode\.findMany\(\{ where: \{[^\n]+generalSchoolRundownWhere\(organisationId\)/);
  assert.match(route, /schoolRundown\.findFirst\(\{ where: \{[^\n]+generalSchoolRundownWhere\(organisationId\)/);
  assert.match(route, /permittedUses: \{ has: "SCHOOL_RADIO" \}/);
  assert.match(route, /mediaAsset: \{ organisationId, status: "READY", \.\.\.GENERAL_STUDIO_MEDIA_ASSET_WHERE \}/);
  assert.match(route, /project: \{ episodeId: rundown\.episodeId, \.\.\.GENERAL_STUDIO_AUDIO_PROJECT_WHERE \}/);
});

test("School Newsroom and player recheck private sources before story review or playback", async () => {
  const [newsroom, player] = await Promise.all([
    readFile(new URL("../app/api/school-radio/newsroom/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/player-programming.js", import.meta.url), "utf8")
  ]);
  assert.match(newsroom, /schoolNewsStory\.findMany\(\{ where: \{[^\n]+generalSchoolNewsStoryWhere\(organisationId\)/);
  assert.match(newsroom, /schoolNewsStory\.findFirst\(\{ where: \{[^\n]+generalSchoolNewsStoryWhere\(organisationId\)/);
  assert.match(newsroom, /interviewMediaAssetId[^\n]+\.\.\.GENERAL_STUDIO_MEDIA_ASSET_WHERE/);
  assert.match(player, /schoolRundown\.findMany\(\{[\s\S]*?generalSchoolRundownWhere\(player\.organisationId, instant\)/);
  assert.match(player, /safeAnnouncementIds\.has\(slot\.announcement\.promoVersion\.mediaAsset\.id\)/);
});
