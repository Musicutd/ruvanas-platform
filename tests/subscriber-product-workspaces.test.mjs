import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Retail, School and Online Radio have separate subscriber dashboards", async () => {
  const [retail, school, radio, shared, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/retail/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/ProductDashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/product-dashboard.module.css", import.meta.url), "utf8")
  ]);

  assert.match(retail, /Retail Radio dashboard/);
  assert.match(retail, /organisationId/);
  assert.match(school, /School Radio dashboard/);
  assert.match(school, /schoolRadioEnabled/);
  assert.match(school, /schoolEpisode\.count\(\{ where: \{ organisationId:/);
  assert.match(radio, /Online Radio dashboard/);
  assert.match(radio, /stationLimit/);
  assert.match(shared, /Service status/);
  assert.match(shared, /Complimentary service · active until Ruvanas stops it/);
  assert.match(styles, /@media \(max-width: 660px\)/);
  assert.match(styles, /:focus-visible/);
});

test("complimentary access is perpetual, organisation-bound and duplicate-safe", async () => {
  const [createRoute, redeemRoute, revokeRoute, admin, account] = await Promise.all([
    readFile(new URL("../app/api/admin/complimentary-access/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/complimentary-access/redeem/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/complimentary-access/[codeId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/complimentary-access/ComplimentaryAccessAdmin.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/complimentary-access/ComplimentaryAccessClient.js", import.meta.url), "utf8")
  ]);

  assert.match(createRoute, /status: \{ in: \["ISSUED", "ACTIVE"\] \}/);
  assert.match(createRoute, /runSerializableTransaction\(prisma/);
  assert.match(createRoute, /Only a Ruvanas Super Admin can issue complimentary access/);
  assert.match(redeemRoute, /accessCode\.organisationId !== context\.membership\.organisationId/);
  assert.match(revokeRoute, /Only a Ruvanas Super Admin can stop complimentary access/);
  assert.doesNotMatch(createRoute, /expiresAt/);
  assert.match(admin, /No automatic expiry/);
  assert.match(admin, /Until Super Admin disables/);
  assert.match(account, /not a timed trial/);
});
