import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeSubscriberSupportRequest,
  subscriberSupportCategoryLabel,
  subscriberSupportStatus,
  subscriberSupportVisibility
} from "../lib/subscriber-support.mjs";
import { buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";

test("subscriber support input is bounded and category allow-listed", () => {
  assert.deepEqual(normalizeSubscriberSupportRequest({
    category: " player ",
    subject: "  Player   stopped  ",
    description: "The enrolled shop player stopped after the current track ended."
  }), {
    category: "PLAYER",
    subject: "Player stopped",
    description: "The enrolled shop player stopped after the current track ended."
  });
  assert.throws(() => normalizeSubscriberSupportRequest({ category: "URGENT", subject: "Help", description: "A long enough description for this support request." }), /Select/);
  assert.throws(() => normalizeSubscriberSupportRequest({ category: "OTHER", subject: "Hi", description: "A long enough description for this support request." }), /subject/);
  assert.throws(() => normalizeSubscriberSupportRequest({ category: "OTHER", subject: "Help", description: "Too short" }), /20/);
});

test("owners and managers see organisation requests while other members see only their own", () => {
  assert.deepEqual(subscriberSupportVisibility({ membershipRole: "OWNER", userId: "user-1" }), {});
  assert.deepEqual(subscriberSupportVisibility({ membershipRole: "MANAGER", userId: "user-1" }), {});
  assert.deepEqual(subscriberSupportVisibility({ membershipRole: "VIEWER", userId: "user-1" }), { createdByUserId: "user-1" });
  assert.deepEqual(subscriberSupportVisibility({ membershipRole: "CONTENT_EDITOR", userId: "user-2" }), { createdByUserId: "user-2" });
  assert.throws(() => subscriberSupportVisibility({ membershipRole: "VIEWER" }), /signed-in/);
});

test("subscriber support labels remain safe for unknown historical values", () => {
  assert.equal(subscriberSupportCategoryLabel("PLAYER"), "Shop player or live audio");
  assert.equal(subscriberSupportCategoryLabel("LEGACY"), "General support");
  assert.equal(subscriberSupportStatus("WAITING_CUSTOMER"), "Waiting for you");
  assert.equal(subscriberSupportStatus("UNKNOWN"), "Received");
});

test("subscriber support is linked from navigation and the Help Centre", async () => {
  const navigation = buildSubscriberNavigation({ entitlements: {}, firstStationId: null });
  const support = navigation.flatMap((section) => section.items).find((item) => item.id === "support");
  assert.equal(support.href, "/dashboard/support");

  const [help, client, route] = await Promise.all([
    readFile(new URL("../app/dashboard/help/HelpCentreClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/support/SubscriberSupportClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/support/requests/route.js", import.meta.url), "utf8")
  ]);
  assert.match(help, /\/dashboard\/support/);
  assert.match(client, /Do not include passwords/);
  assert.match(client, /<SkipLink/);
  assert.match(client, /id="main-content"/);
  assert.match(route, /organisationId: membership\.organisationId/);
  assert.match(route, /subscriberSupportVisibility/);
  assert.match(route, /recentCount >= 3/);
  assert.match(route, /SUBSCRIBER_SUPPORT_REQUEST_CREATED/);
  assert.match(route, /context\.user\.role === "STUDENT"/);
  assert.doesNotMatch(route, /description: input\.description[\s\S]{0,500}details: \{[\s\S]{0,500}description:/);
});
