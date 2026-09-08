import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertStudioRenderReady,
  studioDestinationAvailability,
  studioHandoffKey,
  studioWorkflowPath
} from "../lib/studio-product-handoff.mjs";

test("Studio F exposes only product destinations enabled for the organisation", () => {
  const destinations = studioDestinationAvailability({
    entitlements: { retailRadioEnabled: true, schoolRadioEnabled: true, onlineRadioEnabled: false },
    project: { episodeId: "episode-1" }
  });
  assert.equal(destinations.find((item) => item.key === "RETAIL_PROMOTION").available, true);
  assert.equal(destinations.find((item) => item.key === "SCHOOL_EPISODE").available, true);
  assert.equal(destinations.find((item) => item.key === "ONLINE_PODCAST").available, false);
  assert.match(destinations.find((item) => item.key === "ONLINE_PODCAST").reason, /not included/);
});

test("Studio F requires a linked episode for the School handoff", () => {
  const destinations = studioDestinationAvailability({
    entitlements: { retailRadioEnabled: false, schoolRadioEnabled: true, onlineRadioEnabled: false },
    project: { episodeId: null }
  });
  const school = destinations.find((item) => item.key === "SCHOOL_EPISODE");
  assert.equal(school.available, false);
  assert.match(school.reason, /Link this Studio project/);
});

test("Studio F creates stable idempotency keys and private workflow paths", () => {
  assert.equal(studioHandoffKey({ renderId: "render-1", destination: "RETAIL_PROMOTION" }), "render-1:RETAIL_PROMOTION:none");
  assert.equal(studioHandoffKey({ renderId: "render-1", destination: "SCHOOL_EPISODE", targetEpisodeId: "episode-1" }), "render-1:SCHOOL_EPISODE:episode-1");
  assert.equal(studioWorkflowPath({ destination: "RETAIL_PROMOTION", promoVersionId: "promo 1", mediaAssetId: "asset-1" }), "/dashboard/promotions?promoVersionId=promo%201");
  assert.equal(studioWorkflowPath({ destination: "ONLINE_PODCAST", promoVersionId: "promo-1", mediaAssetId: "asset 1" }), "/dashboard/podcasts?mediaAssetId=asset%201");
});

test("Studio F rejects unfinished or unapproved renders", () => {
  assert.throws(() => assertStudioRenderReady({ status: "RUNNING" }), /completed Studio render/);
  assert.throws(() => assertStudioRenderReady({ status: "SUCCEEDED", outputMediaAsset: { status: "READY" }, outputPromoVersion: { status: "IN_REVIEW", qcStatus: "PASSED" } }), /Approve the final Studio output/);
  const ready = { status: "SUCCEEDED", outputMediaAsset: { status: "READY" }, outputPromoVersion: { status: "APPROVED", qcStatus: "PASSED" } };
  assert.equal(assertStudioRenderReady(ready), ready);
});

test("Studio F route keeps organisation, entitlement, approval and audit gates", async () => {
  const [route, client, podcastPage, migration] = await Promise.all([
    readFile(new URL("../app/api/school-radio/studio-destinations/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/StudioDestinationsClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/podcasts/page.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261030000000_studio_f_product_handoffs/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(route, /requireActiveSchoolRadio/);
  assert.match(route, /organisationId: access\.organisation\.id/);
  assert.match(route, /assertStudioRenderReady/);
  assert.match(route, /definition\.entitlement/);
  assert.match(route, /STUDIO_PRODUCT_HANDOFF_CREATED/);
  assert.match(route, /billingMutation: false/);
  assert.match(route, /publicPublication: false/);
  assert.match(client, /Send to a Ruvanas product/);
  assert.match(podcastPage, /initialMediaAssetId/);
  assert.match(migration, /destinationKey/);
});
