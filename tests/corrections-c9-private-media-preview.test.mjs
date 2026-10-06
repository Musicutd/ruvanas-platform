import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { correctionsPrivateMediaPreviewScope } from "../lib/corrections-private-media-preview.mjs";

function database({ take = false, clip = false, unsubmittedRender = false, submissions = [], rehabilitation = [], announcements = [], distributions = [] } = {}) {
  return {
    audioTake: { findFirst: async () => take ? { id: "private-take" } : null },
    audioClip: { findFirst: async () => clip ? { id: "private-clip" } : null },
    audioRender: { findFirst: async () => unsubmittedRender ? { id: "unsubmitted-render" } : null },
    correctionsSubmission: { findMany: async () => submissions },
    correctionsRehabContent: { findMany: async () => rehabilitation },
    correctionsAnnouncement: { findMany: async () => announcements },
    correctionsNetworkAudioDistribution: { findMany: async () => distributions }
  };
}

test("generic preview denies raw supervised takes, clips and unsubmitted renders even beside a submitted version", async () => {
  const submitted = [{ renderId: "render-a", facilityId: "facility-a", evidenceSnapshot: { renderId: "render-a", mediaAssetId: "asset-a" } }];
  for (const protectedUse of [{ take: true }, { clip: true }, { unsubmittedRender: true }]) {
    assert.equal((await correctionsPrivateMediaPreviewScope(database({ ...protectedUse, submissions: submitted }), "asset-a")).available, false);
  }
  assert.equal((await correctionsPrivateMediaPreviewScope(database(), "asset-a")).available, false);
  assert.equal((await correctionsPrivateMediaPreviewScope(database({ submissions: [{ renderId: "render-a", facilityId: "facility-a", evidenceSnapshot: { renderId: "render-a", mediaAssetId: "other-asset" } }] }), "asset-a")).available, false);
  assert.equal((await correctionsPrivateMediaPreviewScope(database({ submissions: [{ renderId: "render-a", facilityId: "facility-a", evidenceSnapshot: { renderId: "other-render", mediaAssetId: "asset-a" } }] }), "asset-a")).available, false);
});

test("exact submitted review and direct protected uses remain facility-scoped", async () => {
  const scope = await correctionsPrivateMediaPreviewScope(database({
    submissions: [{ renderId: "render-a", facilityId: "facility-a", evidenceSnapshot: { renderId: "render-a", mediaAssetId: "asset-a" } }],
    rehabilitation: [{ facilityId: "facility-b" }],
    announcements: [{ facilityId: "facility-a" }],
    distributions: [{ sourceFacilityId: "facility-b", targetFacilityId: "facility-c" }]
  }), "asset-a");
  assert.deepEqual(scope, { protectedUse: true, available: true, facilityIds: ["facility-a", "facility-b", "facility-c"], ownerOnly: false });
  assert.deepEqual(await correctionsPrivateMediaPreviewScope(database({ rehabilitation: [{ facilityId: null }] }), "asset-a"), {
    protectedUse: true, available: true, facilityIds: [], ownerOnly: true
  });
});

test("generic stream denies unsubmitted sources before storage; DELETE commits protected-use check before R2 removal", async () => {
  const [stream, deletion] = await Promise.all([
    readFile(new URL("../app/api/media/[mediaAssetId]/stream/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/[mediaAssetId]/route.js", import.meta.url), "utf8")
  ]);
  assert.match(stream, /generalStudioMediaAssetIds\(prisma, asset\.organisationId, \[asset\.id\]\)/);
  assert.match(stream, /if \(!scope\.available\) return NextResponse\.json/);
  assert.ok(stream.indexOf("if (!scope.available)") < stream.indexOf("new GetObjectCommand"));
  assert.match(deletion, /FOR UPDATE/);
  assert.match(deletion, /GENERAL_STUDIO_MEDIA_ASSET_WHERE/);
  assert.match(deletion, /privateScope\.protectedUse/);
  assert.match(deletion, /Key: deletedMedia\.storageKey/);
  assert.ok(deletion.indexOf("await tx.mediaAsset.delete") < deletion.indexOf("new DeleteObjectCommand"));
  assert.ok(deletion.indexOf("await tx.mediaAsset.delete") < deletion.indexOf("await r2.client.send"));
});

test("a recent generic player intent cannot revive cancelled or private Inside audio", async () => {
  const playerMedia = await readFile(new URL("../app/api/player/media/[mediaAssetId]/route.js", import.meta.url), "utf8");
  const start = playerMedia.indexOf("const recentInsertionIntents =");
  const end = playerMedia.indexOf("let recentInsertionIntent =", start);
  assert.ok(start >= 0 && end > start, "the generic recent-intent fallback must remain identifiable");
  const fallback = playerMedia.slice(start, end);
  for (const field of ["cancelledAt", "correctionsRequestId", "correctionsRehabContentId",
    "correctionsProgrammeId", "correctionsSubmissionId", "correctionsTrackId",
    "correctionsAnnouncementId", "correctionsOverrideId"]) {
    assert.match(fallback, new RegExp(`${field}: null`), field);
  }
  assert.match(playerMedia, /schoolMediaIntentIsCurrent\(prisma, \{ player, intent, instant \}\)/);
});

test("ordinary campaign and direct player media routes recheck current Inside privacy before storage", async () => {
  const [programming, playerMedia, publicMedia] = await Promise.all([
    readFile(new URL("../lib/player-programming.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/player/media/[mediaAssetId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/player/[slug]/media/[mediaAssetId]/route.js", import.meta.url), "utf8")
  ]);
  const campaignQuery = programming.match(/prisma\.campaign\.findMany\(\{[\s\S]*?\n    \}\)/)?.[0];
  assert.ok(campaignQuery, "campaign manifest query must remain identifiable");
  assert.match(campaignQuery, /promoVersion:\s*\{\s*mediaAsset:\s*\{\s*is:/);
  assert.match(campaignQuery, /GENERAL_STUDIO_MEDIA_ASSET_WHERE/);
  for (const route of [playerMedia, publicMedia]) {
    assert.match(route, /GENERAL_STUDIO_MEDIA_ASSET_WHERE/);
    assert.match(route, /status: "READY"/);
    assert.ok(route.indexOf("GENERAL_STUDIO_MEDIA_ASSET_WHERE") < route.indexOf("protectedAudioResponse(request, asset)"));
  }
  // Approved School exchange insertions may originate from another
  // organisation; the existing insertion authority, not source ownership,
  // controls that route before the shared privacy check.
  assert.doesNotMatch(playerMedia, /organisationId:\s*player\.organisationId[^\n]*libraryType:\s*"RUVANAS_CATALOGUE"/);
  assert.match(playerMedia, /resolution\.reason === "CORRECTIONS_PRIVATE" && isCurrentInsideAudio/);
});
