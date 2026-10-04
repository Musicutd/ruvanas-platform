import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GENERAL_STUDIO_AUDIO_PROJECT_WHERE,
  GENERAL_STUDIO_MEDIA_ASSET_WHERE,
  assertGeneralStudioAudioProject,
  lockGeneralStudioAudioProject,
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

test("general Studio locks the project before rechecking its private predicate", async () => {
  const calls = [];
  const database = {
    $queryRaw: async (parts, projectId, organisationId) => {
      calls.push([String.raw(parts), projectId, organisationId]);
      return [{ id: projectId }];
    },
    audioProject: { findFirst: async (args) => {
      calls.push(args);
      return null;
    } }
  };
  await assert.rejects(lockGeneralStudioAudioProject(database, "org-1", "project-1"),
    (error) => error?.status === 403 && error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED");
  assert.match(calls[0][0], /"AudioProject".*FOR UPDATE/);
  assert.deepEqual(calls[0].slice(1), ["project-1", "org-1"]);
  assert.deepEqual(calls[1].where.NOT, GENERAL_STUDIO_AUDIO_PROJECT_WHERE.NOT);
  database.audioProject.findFirst = async (args) => ({ id: args.where.id, currentVersion: 3 });
  assert.equal((await lockGeneralStudioAudioProject(database, "org-1", "project-1")).currentVersion, 3);
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

test("Studio product handoffs lock and recheck an exact render before listing or reusing it", async () => {
  const route = await readFile(new URL("../app/api/school-radio/studio-destinations/route.js", import.meta.url), "utf8");
  const lockedRender = route.slice(route.indexOf("async function lockedGeneralRender"), route.indexOf("async function assertGeneralHandoffOutput"));
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const post = route.slice(route.indexOf("export async function POST"));
  assert.match(lockedRender, /await lockGeneralStudioAudioProject\(tx, organisationId, locator\.projectId\)/);
  assert.ok(lockedRender.indexOf("await lockGeneralStudioAudioProject") < lockedRender.indexOf("return findRender(tx"));
  assert.match(get, /prisma\.\$transaction\([\s\S]*isolationLevel: "ReadCommitted"/);
  assert.ok(get.indexOf("lockedGeneralRender(tx") < get.indexOf("tx.studioProductHandoff.findMany"));
  assert.match(route, /async function runLockedHandoffTransaction[\s\S]*isolationLevel: "ReadCommitted"/);
  assert.match(route, /error\?\.code !== "P2002" \|\| attempt === 3/);
  assert.match(post, /runLockedHandoffTransaction\(async \(tx\)/);
  assert.match(post, /assertStudioRenderReady\(await lockedGeneralRender\(tx, renderId, access\.organisation\.id\)\)/);
  assert.ok(post.indexOf("assertStudioRenderReady") < post.indexOf("tx.studioProductHandoff.findUnique"));
  assert.ok(post.indexOf("tx.studioProductHandoff.findUnique") < post.indexOf("tx.studioProductHandoff.create"));
  assert.doesNotMatch(get + post, /prisma\.studioProductHandoff\.find/);
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
  for (const path of [
    "../app/api/school-radio/audio-lab/route.js",
    "../app/api/school-radio/audio-lab/uploads/route.js",
    "../app/api/school-radio/audio-lab/uploads/[uploadId]/parts/[partNumber]/route.js",
    "../app/api/school-radio/audio-lab/uploads/[uploadId]/complete/route.js",
    "../app/api/school-radio/audio-lab/projects/[projectId]/editor/route.js",
    "../app/api/school-radio/multitrack/projects/[projectId]/route.js"
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /lockGeneralStudioAudioProject|lockWritableWaveformProject/,
      `${path} must hold the project lock before writing`);
  }
  const completion = await readFile(new URL("../app/api/school-radio/audio-lab/uploads/[uploadId]/complete/route.js", import.meta.url), "utf8");
  assert.match(completion.slice(completion.indexOf("} catch (error) {")), /lockGeneralStudioAudioProject\(tx, access\.organisation\.id, session\.projectId\)/,
    "failed upload cleanup must recheck the project under the C3 lock");
  assert.ok(completion.indexOf("await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: finalKey }))") > completion.indexOf("} catch (error) {"),
    "a denied final database write must remove the copied output object");
  const uploadStart = await readFile(new URL("../app/api/school-radio/audio-lab/uploads/route.js", import.meta.url), "utf8");
  assert.match(uploadStart, /schoolAudioUploadSession\.aggregate\(\{ where: \{[^\n]+expiresAt: \{ gt: new Date\(\) \}/,
    "expired upload sessions must not retain an organisation quota reservation");
  const uploadPart = await readFile(new URL("../app/api/school-radio/audio-lab/uploads/[uploadId]/parts/[partNumber]/route.js", import.meta.url), "utf8");
  assert.match(uploadPart, /CORRECTIONS_STUDIO_OUTPUT_BLOCKED[\s\S]*schoolAudioUploadSession\.updateMany\([\s\S]*status: "FAILED"/,
    "a private transition during a part upload must release that session's quota reservation");
  const trash = await readFile(new URL("../lib/audio-take-trash-service.js", import.meta.url), "utf8");
  assert.match(trash, /withLockedGeneralTake/);
  assert.match(trash, /assertGeneralStudioMediaAsset/);
  assert.ok(trash.indexOf('data: { status: "DELETED" }') < trash.indexOf("await storage.client.send(new DeleteObjectCommand"));
});

test("staff render-only submission shares the AudioLab deletion lock before Corrections Guard accepts it", async () => {
  const service = await readFile(new URL("../lib/corrections-programmes-service.js", import.meta.url), "utf8");
  const lock = await readFile(new URL("../lib/corrections-staff-render-source-lock.mjs", import.meta.url), "utf8");
  const submit = service.slice(service.indexOf("export async function submitCorrectionsProgramme"), service.indexOf("export async function reviewCorrectionsProgramme"));
  assert.match(submit, /await lockCorrectionsStaffRenderSources\(tx,/);
  assert.match(submit, /await lockCorrectionsStaffRenderEvidence\(tx, render\)/);
  assert.ok(submit.indexOf("await lockCorrectionsStaffRenderSources") < submit.indexOf("const evidence = correctionsRenderEvidence"));
  assert.ok(submit.indexOf("await lockCorrectionsStaffRenderEvidence") < submit.indexOf("const evidence = correctionsRenderEvidence"));
  assert.match(lock, /"AudioProject".*FOR UPDATE/);
  assert.match(lock, /"AudioTake".*FOR UPDATE/);
  assert.match(lock, /"PromoVersion".*FOR UPDATE/);
  assert.match(lock, /take\.trashedAt \|\| take\.permanentlyDeletedAt/);
});
