import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countCorrectionsPrivacyInventory } from "../lib/corrections-privacy-inventory.mjs";

test("Inside inventory counts only one organisation and reveals no record contents", async () => {
  const calls = [];
  const database = new Proxy({}, {
    get(_target, model) {
      return { count: async (input) => {
        calls.push({ model, input });
        return calls.length;
      } };
    }
  });

  const result = await countCorrectionsPrivacyInventory(database, "tenant-A");
  assert.equal(calls.length, 23);
  assert.deepEqual(Object.keys(result), [
    "contributors", "supervisedSessions", "supervisedStudioProjects", "supervisedStudioVersions",
    "supervisedStudioTakes", "supervisedStudioTracks", "supervisedStudioClips", "supervisedStudioMarkers",
    "supervisedStudioRenders", "supervisedStudioTranscripts", "studioLinkedMediaAssets",
    "submittedVersions", "reviews",
    "familyRequests", "internalRequests", "requestDecisions", "developmentMilestones",
    "rehabilitationContent", "announcements", "priorityOverrides",
    "insidePlaybackProofEvents", "insideCompletedProofEvents", "correctionsAuditEvents"
  ]);
  assert.deepEqual(Object.values(result), Array.from({ length: 23 }, (_, index) => index + 1));
  const projectWhere = { organisationId: "tenant-A", correctionsStudioSessions: { some: { organisationId: "tenant-A" } } };
  const projectRelation = { is: projectWhere };
  assert.deepEqual(calls.find(({ model }) => model === "audioProject").input.where, projectWhere);
  assert.deepEqual(calls.find(({ model }) => model === "audioProjectVersion").input.where, { project: projectRelation });
  for (const model of ["audioTake", "audioRender"]) {
    assert.deepEqual(calls.find((call) => call.model === model).input.where,
      { organisationId: "tenant-A", project: projectRelation });
  }
  for (const model of ["audioTrack", "audioMarker"]) {
    assert.deepEqual(calls.find((call) => call.model === model).input.where,
      { project: projectRelation });
  }
  assert.deepEqual(calls.find(({ model }) => model === "audioClip").input.where,
    { track: { is: { project: projectRelation } } });
  assert.deepEqual(calls.find(({ model }) => model === "transcript").input.where,
    { organisationId: "tenant-A", project: projectRelation });
  assert.deepEqual(calls.find(({ model }) => model === "mediaAsset").input.where, {
    organisationId: "tenant-A", OR: [
      { audioTakes: { some: { organisationId: "tenant-A", project: projectRelation } } },
      { audioRenderOutputs: { some: { organisationId: "tenant-A", project: projectRelation } } },
      { audioClips: { some: { track: { is: { project: projectRelation } } } } }
    ]
  });
  for (const { model, input } of calls) {
    assert.equal(typeof input.where, "object");
    const scope = model === "correctionsReview" ? input.where.submission?.is?.organisationId
      : model === "correctionsContributorMilestone" ? input.where.contributor?.is?.organisationId
        : ["audioProjectVersion", "audioTrack", "audioMarker"].includes(model) ? input.where.project?.is?.organisationId
          : model === "audioClip" ? input.where.track?.is?.project?.is?.organisationId
        : input.where.organisationId;
    assert.equal(scope, "tenant-A", `${String(model)} must be tenant-scoped`);
    assert.deepEqual(Object.keys(input), ["where"]);
  }
  assert.deepEqual(calls.filter(({ model }) => model === "correctionsRequest").map(({ input }) => input.where.source), ["FAMILY", "INTERNAL"]);
  const proofQueries = calls.filter(({ model }) => model === "proofOfPlayEvent").map(({ input }) => input.where);
  assert.equal(proofQueries.length, 2);
  assert.deepEqual(proofQueries.map((where) => where.programmingSource), [
    { startsWith: "CORRECTIONS_" }, { startsWith: "CORRECTIONS_" }
  ]);
  assert.equal(proofQueries[0].eventType, undefined);
  assert.equal(proofQueries[1].eventType, "COMPLETED");
  assert.deepEqual(calls.find(({ model }) => model === "auditLog").input.where.action, { startsWith: "CORRECTIONS_" });
  assert.equal(JSON.stringify(result).includes("tenant-A"), false);
});

test("Inside inventory rejects missing tenant scope before querying", async () => {
  let queried = false;
  const database = new Proxy({}, { get() { queried = true; throw Error("query attempted"); } });
  await assert.rejects(countCorrectionsPrivacyInventory(database, "  "), /single organisation/);
  await assert.rejects(countCorrectionsPrivacyInventory(database, null), /single organisation/);
  assert.equal(queried, false);
});

test("Inside inventory endpoint remains Super Admin-only and never cacheable", () => {
  const route = readFileSync(new URL("../app/api/admin/corrections/privacy-inventory/route.js", import.meta.url), "utf8");
  assert.match(route, /await requirePlatformAdmin\(\)/);
  assert.match(route, /access\.user\.role !== "SUPER_ADMIN"/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /serviceAccount|organisationMember|\.(?:delete|deleteMany|update|upsert|create)\(/);
});
