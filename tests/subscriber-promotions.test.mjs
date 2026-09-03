import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canDraftSubscriberPromotions,
  canPublishSubscriberPromotions,
  describePromotionTarget,
  promotionStatusLabel,
  requirePromotionPreview,
  subscriberPromotionInput
} from "../lib/subscriber-promotions.mjs";
import { buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";

test("promotion roles separate draft preparation from publication", () => {
  assert.equal(canDraftSubscriberPromotions("OWNER"), true);
  assert.equal(canDraftSubscriberPromotions("MANAGER"), true);
  assert.equal(canDraftSubscriberPromotions("CONTENT_EDITOR"), true);
  assert.equal(canDraftSubscriberPromotions("VIEWER"), false);
  assert.equal(canPublishSubscriberPromotions("OWNER"), true);
  assert.equal(canPublishSubscriberPromotions("MANAGER"), true);
  assert.equal(canPublishSubscriberPromotions("CONTENT_EDITOR"), false);
});

test("subscriber promotion input forces the active tenant and protected defaults", () => {
  const input = subscriberPromotionInput({
    organisationId: "untrusted-organisation",
    mandatory: true,
    name: "Lunch offer",
    promoVersionId: "promo-1",
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-09-07",
    targets: [{ targetType: "ALL_LOCATIONS", targetId: "" }],
    schedules: [{ weekday: 1, startsAt: "09:00", endsAt: "17:00" }]
  }, "active-organisation");
  assert.equal(input.organisationId, "active-organisation");
  assert.equal(input.mandatory, false);
  assert.equal(input.maxPromoMinutesPerHour, 12);
  assert.equal(input.minSamePromoGapMinutes, 15);
});

test("preview acknowledgement is mandatory before a promotion draft is saved", () => {
  assert.equal(requirePromotionPreview({ previewAcknowledged: true }), true);
  assert.throws(() => requirePromotionPreview({ previewAcknowledged: false }), /preview/i);
});

test("promotion summaries use safe target and lifecycle labels", () => {
  assert.equal(describePromotionTarget({ targetType: "ALL_LOCATIONS" }), "All active locations");
  assert.equal(describePromotionTarget({ targetType: "ZONE", zoneId: "zone-1" }, { "zone-1": "Marsa / Main floor" }), "Marsa / Main floor");
  assert.equal(promotionStatusLabel({ status: "PUBLISHED", effectiveFrom: "2026-10-01", effectiveTo: "2026-10-10" }, "2026-09-01"), "UPCOMING");
  assert.equal(promotionStatusLabel({ status: "PUBLISHED", effectiveFrom: "2026-08-01", effectiveTo: "2026-08-10" }, "2026-09-01"), "ENDED");
});

test("subscriber navigation exposes promotions only with an active radio service", () => {
  const enabled = buildSubscriberNavigation({ entitlements: { serviceEnabled: true } }).flatMap((section) => section.items);
  const disabled = buildSubscriberNavigation({ entitlements: { serviceEnabled: false } }).flatMap((section) => section.items);
  assert.ok(enabled.some((item) => item.href === "/dashboard/promotions"));
  assert.ok(!disabled.some((item) => item.href === "/dashboard/promotions"));
});

test("subscriber promotion API derives tenancy and blocks protected controls", async () => {
  const [route, action, page] = await Promise.all([
    readFile(new URL("../app/api/promotions/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/promotions/[campaignId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/promotions/page.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /organisationId = context\.membership\.organisationId/);
  assert.match(route, /subscriberPromotionInput\(body, organisationId\)/);
  assert.doesNotMatch(route, /body\.organisationId/);
  assert.match(action, /organisationId: context\.membership\.organisationId/);
  assert.match(action, /record\.mandatory \|\| record\.retailMediaOrder/);
  assert.match(page, /Approved audio only/);
});
