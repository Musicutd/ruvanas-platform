import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { correctionsStudioCurrentTakes } from "../lib/corrections-studio-sources.mjs";
import { MAX_CORRECTIONS_RECORDING_BYTES, requestBodyLimitBytes } from "../lib/request-size-policy.mjs";

function source(overrides = {}) {
  return {
    id: "take-1", mediaAssetId: "audio-1", status: "READY", trashedAt: null,
    mediaAsset: { status: "READY" },
    promoVersion: { id: "version-1", status: "APPROVED", qcStatus: "PASSED",
      promoAsset: { status: "ACTIVE", currentApprovedVersionId: "version-1" } },
    ...overrides
  };
}

test("contributor source access follows current approval and take availability", () => {
  const current = source();
  const recording = source({ id: "take-2", mediaAssetId: "audio-2", promoVersion: null });
  const withdrawn = source({ id: "take-3", mediaAssetId: "audio-3",
    promoVersion: { ...current.promoVersion, status: "SUPERSEDED" } });
  const replaced = source({ id: "take-4", mediaAssetId: "audio-4",
    promoVersion: { ...current.promoVersion,
      promoAsset: { status: "ACTIVE", currentApprovedVersionId: "version-2" } } });
  const failedQc = source({ id: "take-5", mediaAssetId: "audio-5",
    promoVersion: { ...current.promoVersion, qcStatus: "FAILED" } });
  const trashed = source({ id: "take-6", mediaAssetId: "audio-6", trashedAt: new Date() });
  const failedTake = source({ id: "take-7", mediaAssetId: "audio-7", status: "FAILED" });
  assert.deepEqual(correctionsStudioCurrentTakes([current, recording, withdrawn, replaced, failedQc, trashed, failedTake])
    .map((take) => take.id), ["take-1", "take-2"]);
});

test("all contributor playback and editing paths apply current source validation", async () => {
  const paths = [
    "app/api/corrections/contributor/media/[mediaAssetId]/route.js",
    "app/api/corrections/contributor/multitrack/route.js",
    "app/api/corrections/contributor/audio-lab/projects/[projectId]/editor/route.js",
    "lib/corrections-multitrack.js"
  ];
  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /correctionsStudioCurrentTakes\(/, path);
  }
  const media = await readFile(new URL("../app/api/corrections/contributor/media/[mediaAssetId]/route.js", import.meta.url), "utf8");
  assert.match(media, /correctionsStudioSourcesAvailable\(prisma,/, "render playback must recheck its pinned source state");
});

test("contributor recording request limit accommodates the 50 MiB file and multipart envelope", async () => {
  assert.equal(MAX_CORRECTIONS_RECORDING_BYTES, 50 * 1024 * 1024);
  assert.ok(requestBodyLimitBytes("/api/corrections/contributor/recordings") > MAX_CORRECTIONS_RECORDING_BYTES);
  assert.equal(requestBodyLimitBytes("/api/corrections/contributor/recordings/other"), 10 * 1024 * 1024);
  const middleware = await readFile(new URL("../middleware.js", import.meta.url), "utf8");
  assert.match(middleware, /requestBodyLimitBytes\(request\.nextUrl\.pathname\)/);
});
