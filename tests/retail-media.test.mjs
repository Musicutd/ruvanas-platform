import test from "node:test";
import assert from "node:assert/strict";

import {
  normaliseInventoryDayparts,
  normaliseInventoryTargets,
  normaliseRetailMediaInventory,
  normaliseRetailMediaOrder,
  normaliseRetailMediaPartner,
  RETAIL_MEDIA_REPORTING_NOTICE,
  retailMediaOrderApprovalBlockers
} from "../lib/retail-media.mjs";

test("retail-media partners remain commercial records with validated contact details", () => {
  assert.deepEqual(normaliseRetailMediaPartner({
    organisationId: "org_1",
    kind: "advertiser",
    name: "Northwind Foods",
    contactEmail: "MEDIA@EXAMPLE.COM"
  }), {
    organisationId: "org_1",
    kind: "ADVERTISER",
    name: "Northwind Foods",
    legalName: null,
    contactName: null,
    contactEmail: "media@example.com",
    contactPhone: null,
    billingReference: null
  });
  assert.throws(() => normaliseRetailMediaPartner({ organisationId: "org_1", kind: "publisher", name: "Invalid" }), /advertiser or agency/);
});

test("inventory requires unique tenant targets, valid dayparts, dates, and commercial terms", () => {
  assert.throws(() => normaliseInventoryTargets([
    { targetType: "ZONE", targetId: "zone_1" },
    { targetType: "ZONE", targetId: "zone_1" }
  ]), /unique/);
  assert.throws(() => normaliseInventoryDayparts([
    { weekday: 1, startMinute: 600, endMinute: 500 }
  ]), /end after/);

  const inventory = normaliseRetailMediaInventory({
    organisationId: "org_1",
    name: "Morning retail package",
    priceModel: "fixed_fee",
    currencyCode: "eur",
    unitPriceMinor: 125000,
    maxPlays: 2000,
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-09-30",
    targets: [{ targetType: "LOCATION_GROUP", targetId: "group_1" }],
    dayparts: [{ weekday: 1, startMinute: 480, endMinute: 720 }]
  });
  assert.equal(inventory.priceModel, "FIXED_FEE");
  assert.equal(inventory.currencyCode, "EUR");
  assert.equal(inventory.targets[0].locationGroupId, "group_1");
});

test("orders require approved-source identifiers and unique creative versions", () => {
  assert.throws(() => normaliseRetailMediaOrder({
    organisationId: "org_1",
    advertiserId: "advertiser_1",
    inventoryPackageId: "inventory_1",
    name: "Launch order",
    creativePromoVersionIds: ["promo_1", "promo_1"]
  }), /unique/);
  const visualOnly = normaliseRetailMediaOrder({ organisationId: "org_1", advertiserId: "advertiser_1", inventoryPackageId: "inventory_1", name: "Visual launch", creativePromoVersionIds: [], visualAssetIds: ["visual_1"] });
  assert.deepEqual(visualOnly.visualAssetIds, ["visual_1"]);
});

test("subscriber approval stays blocked until inventory and every creative are approved", () => {
  const order = {
    status: "SUBMITTED",
    inventoryPackage: {
      status: "ACTIVE",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-09-30T00:00:00.000Z")
    },
    creatives: [{ status: "APPROVED" }],
    visualCreatives: [{ status: "PENDING" }]
  };
  assert.match(retailMediaOrderApprovalBlockers(order, new Date("2026-09-15T12:00:00.000Z")).join(" "), /Every creative/);
  order.visualCreatives[0].status = "APPROVED";
  assert.deepEqual(retailMediaOrderApprovalBlockers(order, new Date("2026-09-15T12:00:00.000Z")), []);
});

test("retail-media proof language does not claim listeners, viewers, or causality", () => {
  assert.match(RETAIL_MEDIA_REPORTING_NOTICE, /not listeners, viewers, impressions/);
  assert.match(RETAIL_MEDIA_REPORTING_NOTICE, /or proof.*caused/);
});
