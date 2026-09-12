import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("product dashboards stay separate while shared radio station tools accept entitled radio products", async () => {
  const [retail, school, radio, radioLayout, stationLayout, schoolSuiteLayout, shared, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/retail/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/stations/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/ProductDashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/product-dashboard.module.css", import.meta.url), "utf8")
  ]);

  assert.match(retail, /Retail Radio dashboard/);
  assert.match(retail, /organisationId/);
  assert.match(retail, /requireSubscriberProduct\("RETAIL"\)/);
  assert.match(school, /School Radio dashboard/);
  assert.match(school, /requireSubscriberProduct\("SCHOOL"/);
  assert.match(school, /schoolEpisode\.count\(\{ where: \{ organisationId:/);
  assert.match(radio, /Online Radio dashboard/);
  assert.match(radio, /stationLimit/);
  assert.match(radio, /requireSubscriberProduct\("ONLINE"/);
  assert.match(radioLayout, /requireSubscriberProduct\("ONLINE"\)/);
  assert.match(stationLayout, /\["ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"\]/);
  assert.match(stationLayout, /hasSubscriberProduct/);
  assert.match(schoolSuiteLayout, /requireSubscriberProduct\("SCHOOL"\)/);
  assert.match(shared, /Service status/);
  assert.match(shared, /Complimentary service · active until Ruvanas stops it/);
  assert.match(styles, /@media \(max-width: 660px\)/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /\.onboarding \{[^}]*background: linear-gradient\([^}]*var\(--rv-surface-muted\)[^}]*var\(--rv-surface-raised\)/);
  assert.match(styles, /scroll-margin-block-start: 88px/);
  assert.match(styles, /color: var\(--rv-accent-text\)/);
  assert.doesNotMatch(styles, /background: linear-gradient\(135deg, #1a263a, #141e30\)/);
});

test("complimentary access is perpetual and controlled only by Super Admin", async () => {
  const [createRoute, redeemRoute, revokeRoute, admin, account, subscriberNavigation, clientPage] = await Promise.all([
    readFile(new URL("../app/api/admin/complimentary-access/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/complimentary-access/redeem/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/complimentary-access/[codeId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/complimentary-access/ComplimentaryAccessAdmin.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/account/page.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/complimentary-access/page.js", import.meta.url), "utf8")
  ]);

  assert.match(createRoute, /runSerializableTransaction\(prisma/);
  assert.match(createRoute, /Only a Ruvanas Super Admin can grant complimentary access/);
  assert.match(createRoute, /complimentaryAccessActive \|\| activeCode/);
  assert.match(createRoute, /status: "ISSUED"/);
  assert.match(createRoute, /status: "ACTIVE"/);
  assert.match(createRoute, /complimentaryAccessActive: true/);
  assert.match(createRoute, /COMPLIMENTARY_ACCESS_GRANTED/);
  assert.doesNotMatch(createRoute, /code: internalCode/);
  assert.doesNotMatch(createRoute, /billingEvent|billingInvoice/);
  assert.match(redeemRoute, /Client activation is disabled/);
  assert.doesNotMatch(redeemRoute, /prisma/);
  assert.match(revokeRoute, /Only a Ruvanas Super Admin can stop complimentary access/);
  assert.doesNotMatch(createRoute, /expiresAt/);
  assert.match(admin, /Grant free access/);
  assert.doesNotMatch(admin, /navigator\.clipboard|Copy this code now|Enter your complimentary code/);
  assert.match(admin, /No automatic expiry/);
  assert.match(admin, /Until Super Admin disables/);
  assert.match(account, /No subscription charge applies/);
  assert.doesNotMatch(account, /href="\/dashboard\/complimentary-access"/);
  assert.doesNotMatch(subscriberNavigation, /href: "\/dashboard\/complimentary-access"/);
  assert.match(clientPage, /user\.role === "SUPER_ADMIN" \? "\/admin\/complimentary-access" : "\/dashboard\/account"/);
});
