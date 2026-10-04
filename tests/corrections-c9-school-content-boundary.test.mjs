import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generalSchoolNewsStoryWhere, generalSchoolRundownWhere, lockGeneralSchoolItemSource } from "../lib/school-general-content-boundary.mjs";

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
  assert.match(route, /if \(!await lockGeneralSchoolRundown\(tx, organisationId, rundown\.id\)\)/);
  assert.match(route, /const current = await findRundown\(rundown\.id, organisationId, tx\)/);
  assert.match(route, /const slot = await runRundownTransaction\(async \(tx\) =>/);
  assert.match(route, /error\?\.code === "P2034"/);
});

test("School rundown submission and review recheck the locked current sources before changing status", async () => {
  const route = await readFile(new URL("../app/api/school-radio/show-builder/route.js", import.meta.url), "utf8");
  const submit = route.split('if (input.action === "SUBMIT") {')[1]?.split('} else if (input.action === "REVIEW") {')[0];
  const review = route.split('} else if (input.action === "REVIEW") {')[1]?.split('} else if (input.action === "SCHEDULE") {')[0];
  for (const branch of [submit, review]) {
    assert.ok(branch, "the status transition branch is present");
    assert.match(branch, /runRundownTransaction\(async \(tx\) =>/);
    assert.match(branch, /lockGeneralSchoolRundown\(tx, organisationId, rundown\.id\)/);
    assert.match(branch, /const current = await findRundown\(rundown\.id, organisationId, tx\)/);
    assert.ok(branch.indexOf("lockGeneralSchoolRundown") < branch.indexOf("findRundown"));
    assert.ok(branch.indexOf("findRundown") < branch.indexOf("schoolRundown.update"));
    assert.match(branch, /current\.status/);
    assert.match(branch, /current\.revision/);
  }
});

test("School Show Builder item edits and voice-project creation use a locked current rundown", async () => {
  const route = await readFile(new URL("../app/api/school-radio/show-builder/route.js", import.meta.url), "utf8");
  const voice = route.split('if (input.action === "CREATE_VOICE_PROJECT") {')[1]?.split('if (input.action === "ADD_ITEM" || input.action === "UPDATE_ITEM") {')[0];
  const addOrUpdate = route.split('if (input.action === "ADD_ITEM" || input.action === "UPDATE_ITEM") {')[1]?.split('} else if (input.action === "REMOVE_ITEM") {')[0];
  const remove = route.split('} else if (input.action === "REMOVE_ITEM") {')[1]?.split('} else if (input.action === "MOVE_ITEM") {')[0];
  const move = route.split('} else if (input.action === "MOVE_ITEM") {')[1]?.split('} else if (input.action === "SUBMIT") {')[0];
  for (const branch of [voice, addOrUpdate, remove, move]) {
    assert.ok(branch);
    assert.match(branch, /runRundownTransaction\(async \(tx\) =>/);
    assert.match(branch, /const current = await locked(?:Current|Editable)Rundown\(tx, organisationId, rundown\.id\)/);
    assert.ok(branch.indexOf("lockedEditableRundown") < branch.indexOf("invalidateForEdit") || !branch.includes("invalidateForEdit"));
  }
  assert.ok(voice.indexOf("lockedCurrentRundown") < voice.indexOf("tx.audioProject.create"));
  for (const branch of [addOrUpdate, remove, move]) assert.match(branch, /lockedEditableRundown\(tx, organisationId, rundown\.id\)/);
  assert.ok(addOrUpdate.indexOf("validateShowItem(input)") < addOrUpdate.indexOf("lockGeneralSchoolItemSource"));
  assert.ok(addOrUpdate.indexOf("lockGeneralSchoolItemSource") < addOrUpdate.indexOf("validatedItemData"));
  assert.ok(addOrUpdate.indexOf("validatedItemData") < addOrUpdate.indexOf("invalidateForEdit"));
  assert.match(route, /async function lockedCurrentRundown[\s\S]*?lockGeneralSchoolRundown\(tx, organisationId, rundownId\)[\s\S]*?findRundown\(rundownId, organisationId, tx\)/);
});

test("proposed voice source locks project, media and take before insertion", async () => {
  const locks = [];
  const tx = {
    audioTake: { findFirst: async ({ where }) => where.projectId ? { id: "take-a" } : { projectId: "project-a", mediaAssetId: "media-a" } },
    audioProject: { findFirst: async () => ({ id: "project-a" }) },
    $queryRaw: async (strings) => {
      const table = strings.join("").match(/FROM "([A-Za-z]+)"/)?.[1];
      locks.push(table);
      return [{ id: "locked" }];
    }
  };
  await lockGeneralSchoolItemSource(tx, "school-org", { type: "VOICE_TRACK", sourceTakeId: "take-a" });
  assert.deepEqual(locks, ["AudioProject", "MediaAsset", "AudioTake"]);
});

test("proposed School source rejects a version changed after its media was locked", async () => {
  const tx = {
    promoVersion: { findFirst: async ({ where }) => where.mediaAssetId ? null : { mediaAssetId: "original-media" } },
    $queryRaw: async () => [{ id: "original-media" }]
  };
  await assert.rejects(
    lockGeneralSchoolItemSource(tx, "school-org", { type: "JINGLE", sourcePromoVersionId: "version-a" }),
    /selected School source is unavailable/
  );
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
