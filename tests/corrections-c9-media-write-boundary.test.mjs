import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generic promo upload checks private parent and checksum-reused media before storage or version creation", async () => {
  const route = await readFile(new URL("../app/api/media/upload/route.js", import.meta.url), "utf8");
  assert.match(route, /existingAsset && !\(await generalStudioMediaAssetIds\(prisma, organisation\.id, \[existingAsset\.id\]\)\)\.has\(existingAsset\.id\)/);
  assert.match(route, /prisma\.promoAsset\.findFirst\(\{[\s\S]*?versions: \{ every: \{ mediaAsset: \{ is: GENERAL_STUDIO_MEDIA_ASSET_WHERE \} \} \}/);
  assert.match(route, /tx\.promoAsset\.findFirst\(\{[\s\S]*?versions: \{ every: \{ mediaAsset: \{ is: GENERAL_STUDIO_MEDIA_ASSET_WHERE \} \} \}/);
  assert.match(route, /generalStudioMediaAssetIds\(tx, organisation\.id, \[existingAsset\.id\]\)/);
  assert.ok(route.indexOf("const requestedPromoAsset") < route.indexOf("const mediaAsset ="));
  assert.ok(route.indexOf("const requestedPromoAsset") < route.indexOf("new PutObjectCommand"));
  assert.ok(route.indexOf("tx.promoAsset.findFirst") < route.indexOf("tx.promoVersion.create"));
  assert.match(route, /tx\.mediaAsset\.updateMany\(\{\s*where: \{ id: mediaAsset\.id, organisationId: organisation\.id, \.\.\.GENERAL_STUDIO_MEDIA_ASSET_WHERE \}/);
  assert.match(route, /prisma\.mediaAsset\.updateMany\(\{\s*where: \{ id: mediaAsset\.id, organisationId: organisation\.id, \.\.\.GENERAL_STUDIO_MEDIA_ASSET_WHERE \},\s*data: \{ status: "REJECTED" \}/);
  assert.doesNotMatch(route, /prisma\.mediaAsset\.update\(/, "an existing media row must not be changed before the transactional privacy check");
});

test("generic promo submission rechecks both draft media and its parent at the update boundary", async () => {
  const route = await readFile(new URL("../app/api/media/library/[promoVersionId]/submit/route.js", import.meta.url), "utf8");
  assert.match(route, /const ordinaryPromoAsset = \{[\s\S]*?versions: \{ every: \{ mediaAsset: \{ is: GENERAL_STUDIO_MEDIA_ASSET_WHERE \} \} \}/);
  assert.match(route, /prisma\.promoVersion\.findFirst\(\{[\s\S]*?promoAsset: \{ is: ordinaryPromoAsset \},\s*mediaAsset: \{ is: GENERAL_STUDIO_MEDIA_ASSET_WHERE \}/);
  assert.match(route, /tx\.promoVersion\.updateMany\(\{[\s\S]*?promoAsset: \{ is: ordinaryPromoAsset \},\s*mediaAsset: \{ is: GENERAL_STUDIO_MEDIA_ASSET_WHERE \}/);
});

test("generic admin promo surfaces and status changes exclude whole private version histories", async () => {
  const list = await readFile(new URL("../app/api/admin/media/route.js", import.meta.url), "utf8");
  const uploadChoices = await readFile(new URL("../app/admin/media/upload/page.js", import.meta.url), "utf8");
  const status = await readFile(new URL("../app/api/admin/promos/[promoAssetId]/status/route.js", import.meta.url), "utf8");
  const wholeAssetBoundary = /versions: \{ every: \{ mediaAsset: \{ is: GENERAL_STUDIO_MEDIA_ASSET_WHERE \} \} \}/;
  assert.match(list, wholeAssetBoundary);
  assert.match(uploadChoices, wholeAssetBoundary);
  assert.match(status, /prisma\.promoAsset\.findFirst\(\{[\s\S]*?\.\.\.ordinaryPromoAsset/);
  assert.match(status, /tx\.promoAsset\.updateMany\(\{[\s\S]*?\.\.\.ordinaryPromoAsset/);
  assert.match(status, /"MediaAsset"[\s\S]*FOR UPDATE/);
  assert.match(status, /isolationLevel: "ReadCommitted"/);
  assert.ok(status.indexOf('FROM "MediaAsset"') < status.indexOf('FROM "PromoAsset"'),
    "media must be locked before the promo parent to avoid an upload/review lock inversion");
});
