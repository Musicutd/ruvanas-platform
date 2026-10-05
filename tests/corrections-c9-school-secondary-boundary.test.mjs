import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("School Learning excludes protected projects and historical project-linked submissions", async () => {
  const route = await readFile(new URL("../app/api/school-radio/learning/route.js", import.meta.url), "utf8");
  assert.match(route, /GENERAL_STUDIO_AUDIO_PROJECT_WHERE/);
  assert.match(route, /generalSchoolRundownWhere/);
  assert.match(route, /function generalSchoolEpisodeWhere\(organisationId\)/);
  assert.match(route, /function generalSchoolAudioProjectWhere\(organisationId\)/);
  assert.match(route, /GENERAL_STUDIO_AUDIO_PROJECT_WHERE,[\s\S]*episode: \{ is: \{ organisationId, \.\.\.generalSchoolEpisodeWhere\(organisationId\) \} \}/);
  assert.match(route, /function generalSchoolSubmissionWhere\(organisationId\)/);
  assert.match(route, /episode: \{ is: \{ organisationId, \.\.\.generalSchoolEpisodeWhere\(organisationId\) \} \}/);
  assert.match(route, /schoolEpisode\.findMany\(\{ where: \{ organisationId, status: \{ not: "ARCHIVED" \}, \.\.\.generalSchoolEpisodeWhere\(organisationId\)/);
  assert.match(route, /schoolEpisode\.findFirst\(\{ where: \{ id: data\.episodeId, organisationId,[^\n]+\.\.\.generalSchoolEpisodeWhere\(organisationId\)/);
  assert.match(route, /submissions: \{ \.\.\.assignmentInclude\.submissions, where: generalSchoolSubmissionWhere\(organisationId\) \}/);
  assert.match(route, /submission: \{ is: generalSchoolSubmissionWhere\(organisationId\) \}/);
  assert.match(route, /status: \{ in: \["READY", "SUBMITTED"\] \}, \.\.\.generalSchoolAudioProjectWhere\(organisationId\)/);
  assert.match(route, /status: \{ in: \["READY", "SUBMITTED"\] \}, OR: \[\{ studentGroupId:[\s\S]*\.\.\.generalSchoolAudioProjectWhere\(organisationId\)/);
  assert.match(route, /ASSESS_SUBMISSION[\s\S]*generalSchoolSubmissionWhere\(organisationId\)/);
  assert.match(route, /await lockGeneralStudioMediaAssets\(tx, organisationId, \[\.\.\.mediaIds\]\)/);
  assert.match(route, /runGeneralSourceWriteTransaction\(prisma, async \(tx\)/);
  assert.match(route, /CORRECTIONS_STUDIO_OUTPUT_BLOCKED[\s\S]*throw notFound\("The linked School audio is no longer available to Learning\."\)/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
});

test("School Editorial excludes protected media and does not mutate Corrections projects", async () => {
  const route = await readFile(new URL("../app/api/school-radio/editorial/route.js", import.meta.url), "utf8");
  assert.match(route, /submissions: \{\s*where: \{ promoVersion: \{ is: \{ mediaAsset: \{ is: GENERAL_STUDIO_MEDIA_ASSET_WHERE/);
  assert.match(route, /mediaAsset: \{ organisationId, status: "READY", \.\.\.GENERAL_STUDIO_MEDIA_ASSET_WHERE \}/);
  assert.match(route, /tx\.audioProject\.updateMany\(\{ where: \{ organisationId,[^\n]+\.\.\.GENERAL_STUDIO_AUDIO_PROJECT_WHERE/);
});
