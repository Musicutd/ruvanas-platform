import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERAL_STUDIO_MEDIA_ASSET_WHERE,
  GENERAL_STUDIO_AUDIO_PROJECT_WHERE,
  assertGeneralStudioAudioProject,
  assertGeneralStudioMediaAsset,
  generalStudioMediaAssetIds,
  generalStudioUsableMediaAssetIds
} from "../lib/studio-general-asset-boundary.mjs";

test("generic Studio asset predicate excludes every supervised project media path and direct Corrections use", () => {
  const policy = GENERAL_STUDIO_MEDIA_ASSET_WHERE.AND[0].OR;
  assert.deepEqual(policy[0], { organisationId: null }, "global licensed catalogue is not made private by a Corrections timeline clip");
  const blocked = policy[1].NOT.OR;
  assert.deepEqual(blocked[0].audioTakes.some.project.is.OR[0], { correctionsStudioSessions: { some: {} } });
  assert.deepEqual(blocked[0].audioTakes.some.project.is.OR[2], { renders: { some: { correctionsSubmissions: { some: {} } } } }, "a submitted render makes its source project private even without a session or project-linked submission");
  assert.deepEqual(blocked[1].audioRenderOutputs.some.project.is.OR[0], { correctionsStudioSessions: { some: {} } });
  assert.deepEqual(blocked[2].audioRenderOutputs.some.correctionsSubmissions, { some: {} }, "legacy C3 submitted renders are private even without a supervised session");
  assert.deepEqual(blocked[3].promoVersions.some.renderedAudioVersions.some.OR[1], { correctionsSubmissions: { some: {} } }, "promo-version outputs of submitted renders are private");
  assert.deepEqual(blocked[4].audioClips.some.track.is.project.is.OR[0], { correctionsStudioSessions: { some: {} } });
  for (const relation of ["correctionsRehabContent", "correctionsAnnouncements", "correctionsNetworkAudioDistributions"]) {
    assert.deepEqual(blocked.find((branch) => relation in branch)?.[relation], { some: {} });
  }
  for (const branch of [blocked[0], blocked[1], blocked[4]]) {
    assert.match(JSON.stringify(branch), /correctionsSubmissions/, "submitted versions remain private after a session ends");
  }
});

test("generic Studio asset lookup is organisation-scoped, deduplicated and fail-closed", async () => {
  const calls = [];
  const database = { mediaAsset: { findMany: async (query) => {
    calls.push(query);
    return query.where.id.in.includes("ordinary") ? [{ id: "ordinary" }] : [];
  } } };
  assert.deepEqual([...await generalStudioMediaAssetIds(database, "org-a", [])], []);
  assert.equal(calls.length, 0);
  assert.deepEqual([...await generalStudioMediaAssetIds(database, "org-a", ["ordinary", "private", "ordinary", null])], ["ordinary"]);
  assert.deepEqual(calls[0].where.id.in, ["ordinary", "private"]);
  assert.equal(calls[0].where.organisationId, "org-a");
  assert.deepEqual(calls[0].where.AND, GENERAL_STUDIO_MEDIA_ASSET_WHERE.AND);
  assert.deepEqual([...await generalStudioUsableMediaAssetIds(database, "org-a", ["ordinary", "private"])], ["ordinary"]);
  assert.deepEqual(calls.at(-1).where.OR, [{ organisationId: "org-a" }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }]);
  await assertGeneralStudioMediaAsset(database, "org-a", "ordinary");
  await assert.rejects(assertGeneralStudioMediaAsset(database, "org-a", "private"), { status: 403, code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED" });
  await assert.rejects(assertGeneralStudioMediaAsset(database, "org-a", null), { status: 403, code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED" });
  const unavailableDatabase = { mediaAsset: { findMany: async () => { throw Error("database unavailable"); } } };
  await assert.rejects(assertGeneralStudioMediaAsset(unavailableDatabase, "org-a", "ordinary"), /database unavailable/);
});

test("generic Audio Lab project lookup excludes supervised and submitted project versions", async () => {
  const calls = [];
  const database = { audioProject: { findFirst: async (query) => {
    calls.push(query);
    return query.where.id === "ordinary" ? { id: "ordinary" } : null;
  } } };
  await assertGeneralStudioAudioProject(database, "org-a", "ordinary");
  assert.deepEqual(calls[0].where, { id: "ordinary", organisationId: "org-a", ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE });
  await assert.rejects(assertGeneralStudioAudioProject(database, "org-a", "private"), { status: 403, code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED" });
  await assert.rejects(assertGeneralStudioAudioProject(database, "org-a", null), { status: 403, code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED" });
});
