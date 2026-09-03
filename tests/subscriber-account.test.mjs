import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canViewSubscriberBilling,
  formatSubscriberCurrency,
  subscriberAccessPresentation,
  subscriberInvoicePresentation,
  subscriberPlanFeatures,
  subscriberUsageMeter
} from "../lib/subscriber-account.mjs";

test("subscriber account protects financial records while preserving plan visibility", () => {
  assert.equal(canViewSubscriberBilling("OWNER"), true);
  assert.equal(canViewSubscriberBilling("MANAGER"), false);
  assert.equal(canViewSubscriberBilling("CONTENT_EDITOR"), false);
  assert.equal(canViewSubscriberBilling("VIEWER"), false);
});

test("subscriber account uses safe customer-facing access and invoice language", () => {
  assert.deepEqual(subscriberAccessPresentation({ accessReason: "ACTIVE" }), {
    label: "Active",
    tone: "positive",
    description: "Your subscribed services and plan allowances are available."
  });
  assert.equal(subscriberAccessPresentation({ accessReason: "PAYMENT_GRACE_EXPIRED" }).label, "Access paused");
  assert.equal(subscriberAccessPresentation({ serviceEnabled: true, accessReason: "FUTURE_STATUS" }).label, "Available");
  assert.deepEqual(subscriberInvoicePresentation({ status: "PAID" }), { label: "Paid", tone: "positive" });
  assert.deepEqual(subscriberInvoicePresentation({ status: "UNKNOWN" }), { label: "Account record", tone: "neutral" });
});

test("subscriber account formats money and usage without unsafe values", () => {
  assert.match(formatSubscriberCurrency(2500, "EUR"), /25\.00/);
  assert.equal(formatSubscriberCurrency(-1, "EUR"), "—");
  assert.deepEqual(subscriberUsageMeter(3, 4), { value: 3, limit: 4, percent: 75, exceeded: false });
  assert.deepEqual(subscriberUsageMeter(5, 4), { value: 5, limit: 4, percent: 100, exceeded: true });
  assert.deepEqual(subscriberUsageMeter("unsafe", 0), { value: 0, limit: 0, percent: 0, exceeded: false });
});

test("subscriber plan feature summary reflects effective entitlements", () => {
  const features = subscriberPlanFeatures({
    includesRuvanasCatalogue: true,
    promoUploadEnabled: true,
    schoolRadioEnabled: false,
    retailMediaEnabled: true
  });
  assert.equal(features.length, 6);
  assert.equal(features.find((feature) => feature.label === "Ruvanas Music Catalogue").enabled, true);
  assert.equal(features.find((feature) => feature.label === "School Radio").enabled, false);
  assert.equal(features.find((feature) => feature.label === "Retail Media").enabled, true);
});

test("account page is tenant-derived, owner-filtered and does not expose provider identifiers", async () => {
  const [page, styles, navigation] = await Promise.all([
    readFile(new URL("../app/dashboard/account/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/account/subscriber-account.module.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8")
  ]);

  assert.match(page, /getActiveOrganisationContext/);
  assert.match(page, /where: \{ organisationId: organisation\.id \}/);
  assert.match(page, /canViewSubscriberBilling\(membership\.role\)/);
  assert.doesNotMatch(page, /externalCustomerId|externalSubscriptionId/);
  assert.match(page, /Owner-only details/);
  assert.match(page, /<progress/);
  assert.match(navigation, /\/dashboard\/account/);
  assert.match(styles, /@media \(max-width: 620px\)/);
  assert.match(styles, /:focus-visible/);
});
