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

  assert.match(retail, /Retail Control Centre/);
  assert.match(retail, /loadRetailControlCentre/);
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

test("complimentary access codes create perpetual accounts controlled only by Super Admin", async () => {
  const [createRoute, createSchema, redeemRoute, revokeRoute, admin, account, subscriberNavigation, clientPage, login, freeRegistration] = await Promise.all([
    readFile(new URL("../app/api/admin/complimentary-access/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/complimentary-access-request.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/complimentary-access/redeem/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/complimentary-access/[codeId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/complimentary-access/ComplimentaryAccessAdmin.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/account/page.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/complimentary-access/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/register/free-access/FreeAccessRegistration.js", import.meta.url), "utf8")
  ]);

  assert.match(createRoute, /runSerializableTransaction\(prisma/);
  assert.match(createRoute, /Only a Ruvanas Super Admin can grant complimentary access/);
  assert.match(createRoute, /complimentaryAccessActive \|\| activeCode/);
  assert.match(createRoute, /status: "ISSUED"/);
  assert.match(createRoute, /status: "ACTIVE"/);
  assert.match(createRoute, /complimentaryAccessActive: true/);
  assert.match(createRoute, /COMPLIMENTARY_ACCESS_GRANTED/);
  assert.match(createRoute, /complimentaryAccessCreateSchema\.safeParse/);
  assert.match(createSchema, /mode: z\.enum\(\["DIRECT", "CODE"\]\)/);
  assert.match(createRoute, /code: internalCode/);
  assert.match(createRoute, /recipientEmail/);
  assert.doesNotMatch(createRoute, /tx\.(billingEvent|billingInvoice)/);
  assert.match(redeemRoute, /createComplimentaryRegistration/);
  assert.match(redeemRoute, /complimentary-register/);
  assert.match(revokeRoute, /Only a Ruvanas Super Admin can stop complimentary access/);
  assert.doesNotMatch(createRoute, /expiresAt/);
  assert.match(admin, /Grant free access/);
  assert.match(admin, /navigator\.clipboard/);
  assert.match(admin, /Create a one-use registration code/);
  assert.match(admin, /No automatic expiry/);
  assert.match(admin, /Until Super Admin disables/);
  assert.match(account, /No subscription charge applies/);
  assert.doesNotMatch(account, /href="\/dashboard\/complimentary-access"/);
  assert.doesNotMatch(subscriberNavigation, /href: "\/dashboard\/complimentary-access"/);
  assert.match(clientPage, /user\.role === "SUPER_ADMIN" \? "\/admin\/complimentary-access" : "\/dashboard\/account"/);
  assert.match(login, /Create free account with code/);
  assert.match(freeRegistration, /\/api\/complimentary-access\/redeem/);
  assert.match(freeRegistration, /No automatic expiry/);
});
