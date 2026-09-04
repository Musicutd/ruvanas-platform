import { NOTIFICATION_TYPES } from "./job-notification.mjs";

export const NOTIFICATION_VIEWS = ["ALL", "UNREAD", "CRITICAL"];

export const subscriberNotificationDetails = Object.freeze({
  PLAYER_OFFLINE: { label: "Player offline", category: "Playback", actionLabel: "Review players", href: "/dashboard/players" },
  STREAM_ERROR: { label: "Stream problem", category: "Playback", actionLabel: "Check service status", href: "/dashboard" },
  AUTODJ_FAILURE: { label: "AutoDJ needs attention", category: "Programming", actionLabel: "Review programming", href: "/dashboard/programming" },
  CAMPAIGN_FAILURE: { label: "Promotion needs attention", category: "Content", actionLabel: "Review promotions", href: "/dashboard/promotions" },
  PRODUCTION_ORDER_UPDATE: { label: "Studio order update", category: "Production", actionLabel: "Open studio", href: "/dashboard/studio" },
  BILLING_STATE: { label: "Account status", category: "Account", actionLabel: "Review account", href: "/dashboard/account" },
  SCHOOL_REVIEW_REQUEST: { label: "School review requested", category: "School Radio", actionLabel: "Open School Radio", href: "/dashboard/school-radio" },
  CONSENT_EXPIRY: { label: "Consent needs attention", category: "School Radio", actionLabel: "Review safeguarding", href: "/dashboard/school-radio" }
});

export function normalizeNotificationCentreFilters(input = {}) {
  const view = String(input.view || "ALL").trim().toUpperCase();
  const type = String(input.type || "ALL").trim().toUpperCase();
  const take = Math.max(1, Math.min(100, Number(input.take) || 50));
  return {
    view: NOTIFICATION_VIEWS.includes(view) ? view : "ALL",
    type: NOTIFICATION_TYPES.includes(type) ? type : "ALL",
    take
  };
}

export function notificationDeliveryWhere({ organisationId, userId, view = "ALL", type = "ALL" }) {
  const where = {
    organisationId,
    userId,
    channel: "IN_APP",
    status: "DELIVERED",
    dismissedAt: null
  };
  if (view === "UNREAD") where.readAt = null;
  if (view === "CRITICAL") where.notificationEvent = { severity: "CRITICAL" };
  if (type !== "ALL") {
    where.notificationEvent = { ...(where.notificationEvent || {}), type };
  }
  return where;
}

export function subscriberNotificationPresentation(delivery) {
  const event = delivery.notificationEvent || {};
  const details = subscriberNotificationDetails[event.type] || {
    label: "Service update",
    category: "Service",
    actionLabel: "Open dashboard",
    href: "/dashboard"
  };
  return {
    id: delivery.id,
    readAt: delivery.readAt || null,
    createdAt: delivery.createdAt,
    title: String(event.title || details.label).slice(0, 160),
    message: String(event.message || "Open Ruvanas for more information.").slice(0, 500),
    type: event.type || "UNKNOWN",
    typeLabel: details.label,
    category: details.category,
    severity: ["INFO", "WARNING", "CRITICAL"].includes(event.severity) ? event.severity : "INFO",
    occurredAt: event.occurredAt || delivery.createdAt,
    actionLabel: details.actionLabel,
    actionHref: details.href
  };
}

export function groupSubscriberNotifications(deliveries = [], now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1_000);
  const groups = { TODAY: [], YESTERDAY: [], EARLIER: [] };
  for (const delivery of deliveries) {
    const occurredAt = new Date(delivery.occurredAt);
    if (occurredAt >= today) groups.TODAY.push(delivery);
    else if (occurredAt >= yesterday) groups.YESTERDAY.push(delivery);
    else groups.EARLIER.push(delivery);
  }
  return [
    { id: "TODAY", label: "Today", items: groups.TODAY },
    { id: "YESTERDAY", label: "Yesterday", items: groups.YESTERDAY },
    { id: "EARLIER", label: "Earlier", items: groups.EARLIER }
  ].filter((group) => group.items.length > 0);
}
