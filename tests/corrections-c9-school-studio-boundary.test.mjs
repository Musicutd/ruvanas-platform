import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GENERAL_STUDIO_AUDIO_PROJECT_WHERE,
  GENERAL_STUDIO_MEDIA_ASSET_WHERE,
  assertGeneralStudioAudioProject,
  generalStudioUsableMediaAssetIds
} from "../lib/studio-general-asset-boundary.mjs";

test("the shared School Studio boundary denies an absent or Corrections project", async () => {
  assert.match(JSON.stringify(GENERAL_STUDIO_AUDIO_PROJECT_WHERE), /correctionsStudioSessions/);
  assert.match(JSON.stringify(GENERAL_STUDIO_AUDIO_PROJECT_WHERE), /correctionsSubmissions/);
  assert.match(JSON.stringify(GENERAL_STUDIO_MEDIA_ASSET_WHERE), /audioTakes/);
  assert.match(JSON.stringify(GENERAL_STUDIO_MEDIA_ASSET_WHERE), /audioRenderOutputs/);
  let query;
  const database = { audioProject: { findFirst: async (args) => { query = args; return null; } } };
  await assert.rejects(assertGeneralStudioAudioProject(database, "org-1", "project-1"), (error) => error?.status === 403);
  assert.equal(query.where.organisationId, "org-1");
  assert.equal(query.where.id, "project-1");
  assert.deepEqual(query.where.NOT, GENERAL_STUDIO_AUDIO_PROJECT_WHERE.NOT);
  database.audioProject.findFirst = async () => ({ id: "project-1" });
  await assert.doesNotReject(assertGeneralStudioAudioProject(database, "org-1", "project-1"));
});

test("general Studio source IDs are constrained to allowed organisation media or the global catalogue", async () => {
  let query;
  const database = { mediaAsset: { findMany: async (args) => {
    query = args;
    return [{ id: "normal" }, { id: "catalogue" }];
  } } };
  const ids = await generalStudioUsableMediaAssetIds(database, "org-1", ["normal", "private", "catalogue", "normal"]);
  assert.deepEqual([...ids], ["normal", "catalogue"]);
  assert.deepEqual(query.where.id.in, ["normal", "private", "catalogue"]);
  assert.deepEqual(query.where.OR, [{ organisationId: "org-1" }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }]);
  assert.deepEqual(query.where.AND, GENERAL_STUDIO_MEDIA_ASSET_WHERE.AND);
});

test("legacy School Studio routes use the shared boundary for lists, writes, upload stages and handoff", async () => {
  const files = [
    "../app/api/school-radio/audio-lab/route.js",
    "../app/api/school-radio/audio-lab/projects/[projectId]/editor/route.js",
    "../app/api/school-radio/audio-lab/uploads/route.js",
    "../app/api/school-radio/audio-lab/uploads/[uploadId]/route.js",
    "../app/api/school-radio/audio-lab/uploads/[uploadId]/parts/[partNumber]/route.js",
    "../app/api/school-radio/audio-lab/uploads/[uploadId]/complete/route.js",
    "../app/api/school-radio/multitrack/route.js",
    "../app/api/school-radio/multitrack/projects/[projectId]/route.js",
    "../app/api/school-radio/studio-destinations/route.js"
  ];
  for (const path of files) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /studio-general-asset-boundary\.mjs/, `${path} must enforce the private boundary`);
  }
  const trash = await readFile(new URL("../lib/audio-take-trash-service.js", import.meta.url), "utf8");
  assert.match(trash, /withLockedGeneralTake/);
  assert.match(trash, /assertGeneralStudioMediaAsset/);
  assert.ok(trash.indexOf('data: { status: "DELETED" }') < trash.indexOf("await storage.client.send(new DeleteObjectCommand"));
});
