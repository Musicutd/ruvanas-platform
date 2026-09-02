export const SUBSCRIBER_SUPPORT_CATEGORIES = Object.freeze([
  { value: "PLAYER", label: "Shop player or live audio" },
  { value: "PROGRAMMING", label: "Music or schedule" },
  { value: "CONTENT", label: "Audio upload or production" },
  { value: "ACCOUNT", label: "Account or access" },
  { value: "BILLING", label: "Plan or billing" },
  { value: "OTHER", label: "Something else" }
]);

const CATEGORY_VALUES = new Set(SUBSCRIBER_SUPPORT_CATEGORIES.map((category) => category.value));
const ORG_WIDE_ROLES = new Set(["OWNER", "MANAGER"]);

export function normalizeSubscriberSupportRequest(input = {}) {
  const category = String(input.category || "").trim().toUpperCase();
  const subject = String(input.subject || "").trim().replace(/\s+/g, " ");
  const description = String(input.description || "").trim();

  if (!CATEGORY_VALUES.has(category)) throw new Error("Select what you need help with.");
  if (subject.length < 3 || subject.length > 160) throw new Error("Use a subject between 3 and 160 characters.");
  if (description.length < 20 || description.length > 4_000) {
    throw new Error("Describe the problem using between 20 and 4,000 characters.");
  }

  return { category, subject, description };
}

export function subscriberSupportVisibility({ membershipRole = "VIEWER", userId } = {}) {
  if (!userId) throw new Error("A signed-in user is required.");
  return ORG_WIDE_ROLES.has(membershipRole) ? {} : { createdByUserId: userId };
}

export function subscriberSupportCategoryLabel(value) {
  return SUBSCRIBER_SUPPORT_CATEGORIES.find((category) => category.value === value)?.label || "General support";
}

export function subscriberSupportStatus(status) {
  const labels = {
    OPEN: "Received",
    IN_PROGRESS: "In progress",
    WAITING_CUSTOMER: "Waiting for you",
    RESOLVED: "Resolved",
    CLOSED: "Closed"
  };
  return labels[status] || "Received";
}

