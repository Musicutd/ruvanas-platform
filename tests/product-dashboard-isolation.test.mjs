import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  enabledSubscriberProducts,
  hasSubscriberProduct,
  subscriberProductAccess
} from "../lib/product-access.mjs";
import {
  buildSubscriberNavigation,
  buildSubscriberProductCards
} from "../lib/user-experience-navigation.mjs";

const onlineOnly = { serviceEnabled: true, retailRadioEnabled: false, schoolRadioEnabled: false, onlineRadioEnabled: true };
const retailOnly = { serviceEnabled: true, retailRadioEnabled: true, schoolRadioEnabled: false, onlineRadioEnabled: false };
const schoolOnly = { serviceEnabled: true, retailRadioEnabled: false, schoolRadioEnabled: true, onlineRadioEnabled: false };
const healthOnly = { serviceEnabled: true, retailRadioEnabled: false, schoolRadioEnabled: false, onlineRadioEnabled: false, healthRadioEnabled: true, faithRadioEnabled: false };
const faithOnly = { serviceEnabled: true, retailRadioEnabled: false, schoolRadioEnabled: false, onlineRadioEnabled: false, healthRadioEnabled: false, faithRadioEnabled: true };

function itemIds(entitlements) {
  return buildSubscriberNavigation({ entitlements, firstStationId: "station-1" })
    .flatMap((section) => section.items)
    .map((item) => item.id);
}

test("serviceEnabled alone never grants a product dashboard", () => {
  const activeService = { serviceEnabled: true };
  assert.equal(hasSubscriberProduct(activeService, "RETAIL"), false);
  assert.equal(hasSubscriberProduct(activeService, "SCHOOL"), false);
  assert.equal(hasSubscriberProduct(activeService, "ONLINE"), false);
  assert.equal(hasSubscriberProduct(activeService, "HEALTH"), false);
  assert.equal(hasSubscriberProduct(activeService, "FAITH"), false);
  assert.deepEqual(enabledSubscriberProducts(activeService), []);
});

test("inactive service blocks even an explicitly assigned product", () => {
  const access = subscriberProductAccess({ serviceEnabled: false, onlineRadioEnabled: true }, "ONLINE");
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "SERVICE_INACTIVE");
});

test("single-product accounts receive only their owned product card", () => {
  assert.deepEqual(buildSubscriberProductCards({ entitlements: retailOnly }).map((item) => item.id), ["retailHome"]);
  assert.deepEqual(buildSubscriberProductCards({ entitlements: schoolOnly }).map((item) => item.id), ["schoolHome"]);
  assert.deepEqual(buildSubscriberProductCards({ entitlements: onlineOnly }).map((item) => item.id), ["radioHome"]);
  assert.deepEqual(buildSubscriberProductCards({ entitlements: healthOnly }).map((item) => item.id), ["healthHome"]);
  assert.deepEqual(buildSubscriberProductCards({ entitlements: faithOnly }).map((item) => item.id), ["faithHome"]);
});

test("a multi-product account receives each explicitly assigned product", () => {
  const products = buildSubscriberProductCards({ entitlements: {
    serviceEnabled: true,
    retailRadioEnabled: true,
    schoolRadioEnabled: true,
    onlineRadioEnabled: true
  } });
  assert.deepEqual(products.map((item) => item.id), ["retailHome", "schoolHome", "radioHome"]);
});

test("Retail navigation does not leak Online or School administration", () => {
  const ids = itemIds(retailOnly);
  for (const id of ["radioHome", "schoolHome", "station", "publicPlayer", "stationWebsite", "stationNetworks", "syndication", "rightsRoyalty", "distribution", "programmeDirector", "newsroom", "podcasts", "listenerAnalytics", "school"]) {
    assert.ok(!ids.includes(id), `${id} must not be shown to a Retail-only account`);
  }
  assert.ok(ids.includes("retailHome"));
  assert.ok(ids.includes("promotions"));
});

test("School navigation excludes Retail and Online product operations", () => {
  const ids = itemIds(schoolOnly);
  assert.ok(ids.includes("schoolHome"));
  assert.ok(ids.includes("school"));
  for (const id of ["retailHome", "radioHome", "station", "publicPlayer", "promotions", "podcasts", "listenerAnalytics", "retail", "signage"]) {
    assert.ok(!ids.includes(id), `${id} must not be shown to a School-only account`);
  }
});

test("Online navigation excludes Retail and School product language", () => {
  const ids = itemIds(onlineOnly);
  assert.ok(ids.includes("radioHome"));
  assert.ok(ids.includes("station"));
  assert.ok(ids.includes("listenerAnalytics"));
  for (const id of ["retailHome", "schoolHome", "school", "retail", "signage"]) {
    assert.ok(!ids.includes(id), `${id} must not be shown to an Online-only account`);
  }
});

test("product routes and product APIs enforce explicit capabilities", async () => {
  const [guard, organisationAccess, retail, school, radio, health, faith, stationsLayout, schoolSuiteLayout, stationApi, productChannelApi, podcastAccess, analyticsAccess, publicPlayerApi, websiteApi, requestApi] = await Promise.all([
    readFile(new URL("../lib/subscriber-product-access.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/access-control.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/retail/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/health/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/faith/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/stations/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/product-channels/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/podcast-access.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/listener-analytics-access.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/public-player/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/website/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/listener-requests/route.js", import.meta.url), "utf8")
  ]);
  assert.match(guard, /subscriberProductAccess/);
  assert.match(organisationAccess, /requireOrganisationProductAccess/);
  assert.match(retail, /requireSubscriberProduct\("RETAIL"\)/);
  assert.match(school, /requireSubscriberProduct\("SCHOOL"/);
  assert.match(radio, /requireSubscriberProduct\("ONLINE"\)/);
  assert.match(health, /requireSubscriberProduct\("HEALTH"/);
  assert.match(faith, /requireSubscriberProduct\("FAITH"/);
  assert.match(stationsLayout, /\["ONLINE", "HEALTH", "FAITH"\]/);
  assert.match(schoolSuiteLayout, /requireSubscriberProduct\("SCHOOL"\)/);
  assert.match(stationApi, /entitlements\.onlineRadioEnabled/);
  assert.match(productChannelApi, /entitlements\[product\.capability\]/);
  assert.match(podcastAccess, /PODCAST_ACCESS/);
  assert.match(analyticsAccess, /entitlements\.onlineRadioEnabled/);
  assert.match(publicPlayerApi, /requireOrganisationProductAccess\(station\.organisationId, product/);
  assert.match(websiteApi, /subscriberProductForStationFamily\(station\.productFamily\)/);
  assert.match(requestApi, /subscriberProductForStationFamily\(station\.productFamily\)/);
});

test("blocked product access leads to a clear account explanation", async () => {
  const account = await readFile(new URL("../app/dashboard/account/page.js", import.meta.url), "utf8");
  assert.match(account, /Product access/);
  assert.match(account, /is not included in this organisation's current access/);
  assert.match(account, /service is not active/);
});
