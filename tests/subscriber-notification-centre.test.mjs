import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  groupSubscriberNotifications,
  normalizeNotificationCentreFilters,
  notificationDeliveryWhere,
  subscriberNotificationDetails,
  subscriberNotificationPresentation
} from "../lib/subscriber-notification-centre.mjs";
import { buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";

test("notification centre filters are allow-listed and bounded", () => {
  assert.deepEqual(normalizeNotificationCentreFilters({ view: "unread", type: "player_offline", take: 500 }), { view: "UNREAD", type: "PLAYER_OFFLINE", take: 100 });
  assert.deepEqual(normalizeNotificationCentreFilters({ view: "invented", type: "private_event", take: -2 }), { view: "ALL", type: "ALL", take: 1 });
});

test("notification queries retain exact user and organisation scope", () => {
  const unread = notificationDeliveryWhere({ organisationId: "org-1", userId: "user-1", view: "UNREAD", type: "BILLING_STATE" });
  assert.equal(unread.organisationId, "org-1");
  assert.equal(unread.userId, "user-1");
  assert.equal(unread.channel, "IN_APP");
  assert.equal(unread.dismissedAt, null);
  assert.equal(unread.readAt, null);
  assert.deepEqual(unread.notificationEvent, { type: "BILLING_STATE" });
  const critical = notificationDeliveryWhere({ organisationId: "org-1", userId: "user-1", view: "CRITICAL", type: "PLAYER_OFFLINE" });
  assert.deepEqual(critical.notificationEvent, { severity: "CRITICAL", type: "PLAYER_OFFLINE" });
});

test("subscriber presentation replaces internal codes with safe task links", () => {
  const item = subscriberNotificationPresentation({
    id: "delivery-1",
    readAt: null,
    createdAt: new Date("2026-09-03T10:00:00.000Z"),
    notificationEvent: {
      type: "CAMPAIGN_FAILURE",
      severity: "CRITICAL",
      title: "Promotion requires review",
      message: "An approved promotion could not be scheduled.",
      occurredAt: new Date("2026-09-03T09:58:00.000Z"),
      entityId: "must-not-leak",
      correlationId: "must-not-leak",
      metadata: { secret: "must-not-leak" }
    }
  });
  assert.equal(item.typeLabel, "Promotion needs attention");
  assert.equal(item.actionHref, "/dashboard/promotions");
  assert.equal(item.actionLabel, "Review promotions");
  assert.deepEqual(Object.keys(item).sort(), ["actionHref", "actionLabel", "category", "createdAt", "id", "message", "occurredAt", "readAt", "severity", "title", "type", "typeLabel"].sort());
  for (const details of Object.values(subscriberNotificationDetails)) assert.match(details.href, /^\/dashboard(?:\/|$)/);
});

test("notifications are grouped by the subscriber local day", () => {
  const now = new Date(2026, 8, 3, 15, 0, 0);
  const groups = groupSubscriberNotifications([
    { id: "today", occurredAt: new Date(2026, 8, 3, 9, 0, 0) },
    { id: "yesterday", occurredAt: new Date(2026, 8, 2, 12, 0, 0) },
    { id: "earlier", occurredAt: new Date(2026, 7, 30, 12, 0, 0) }
  ], now);
  assert.deepEqual(groups.map((group) => [group.label, group.items.map((item) => item.id)]), [
    ["Today", ["today"]],
    ["Yesterday", ["yesterday"]],
    ["Earlier", ["earlier"]]
  ]);
});

test("notification API derives tenancy and bulk actions remain scoped", async () => {
  const [route, service] = await Promise.all([
    readFile(new URL("../app/api/notifications/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/job-notification-service.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /getActiveOrganisationContext/);
  assert.match(route, /context\.membership\.organisationId/);
  assert.match(route, /context\.user\.id/);
  assert.match(route, /MARK_ALL_READ/);
  assert.match(route, /DISMISS_READ/);
  assert.match(route, /Cache-Control.*private, no-store/);
  assert.match(service, /bulkUpdateSubscriberNotifications/);
  assert.match(service, /organisationId, userId, channel: "IN_APP"/);
  assert.doesNotMatch(service, /metadata:\s*true/);
});

test("professional notification workspace is accessible and responsive", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/notifications/NotificationsClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/notifications/notifications.module.css", import.meta.url), "utf8")
  ]);
  assert.match(client, /id="main-content"/);
  assert.match(client, /aria-label="Notification view"/);
  assert.match(client, /aria-pressed/);
  assert.match(client, /<select/);
  assert.match(client, /role="status"/);
  assert.match(client, /Dismiss all read notifications/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  const navigation = buildSubscriberNavigation({ entitlements: {}, firstStationId: null });
  assert.equal(navigation.flatMap((section) => section.items).find((item) => item.id === "notifications").label, "Notification centre");
});
