export const SUBSCRIBER_PRODUCTS = Object.freeze({
  RETAIL: Object.freeze({
    key: "RETAIL",
    id: "retailHome",
    capability: "retailRadioEnabled",
    href: "/dashboard/retail",
    label: "Retail Radio",
    description: "Run music, promotions and players across shops and customer spaces.",
    symbol: "RETAIL"
  }),
  SCHOOL: Object.freeze({
    key: "SCHOOL",
    id: "schoolHome",
    capability: "schoolRadioEnabled",
    href: "/dashboard/school",
    label: "School Radio",
    description: "Manage safeguarded student broadcasting, learning and publishing.",
    symbol: "SCHOOL"
  }),
  ONLINE: Object.freeze({
    key: "ONLINE",
    id: "radioHome",
    capability: "onlineRadioEnabled",
    href: "/dashboard/radio",
    label: "Online Radio",
    description: "Operate stations, live listeners and professional online programming.",
    symbol: "RADIO"
  }),
  HEALTH: Object.freeze({
    key: "HEALTH",
    id: "healthHome",
    capability: "healthRadioEnabled",
    href: "/dashboard/health",
    label: "Ruvanas Health",
    description: "Operate hospital and wellbeing audio with privacy-aware requests, sites and channels.",
    symbol: "HEALTH"
  }),
  FAITH: Object.freeze({
    key: "FAITH",
    id: "faithHome",
    capability: "faithRadioEnabled",
    href: "/dashboard/faith",
    label: "Ruvanas Faith",
    description: "Run continuous faith radio, live services, teachings and multi-campus media.",
    symbol: "FAITH"
  }),
  ORGANISATIONS: Object.freeze({
    key: "ORGANISATIONS",
    id: "organisationsHome",
    capability: "organisationsEnabled",
    href: "/dashboard/organisations",
    label: "Ruvanas Organisations",
    description: "Coordinate subscriber-operated channels, announcements, events and displays.",
    symbol: "ORGANISATIONS"
  })
});

export const SUBSCRIBER_PRODUCT_LIST = Object.freeze(Object.values(SUBSCRIBER_PRODUCTS));

export function normalizeSubscriberProduct(product) {
  const key = String(product || "").trim().toUpperCase();
  return SUBSCRIBER_PRODUCTS[key] || null;
}

export function subscriberProductAccess(entitlements = {}, product) {
  const definition = normalizeSubscriberProduct(product);
  if (!definition) return { allowed: false, reason: "UNKNOWN_PRODUCT", product: null };
  if (!entitlements.serviceEnabled) return { allowed: false, reason: "SERVICE_INACTIVE", product: definition };
  if (!entitlements[definition.capability]) return { allowed: false, reason: "PRODUCT_NOT_INCLUDED", product: definition };
  return { allowed: true, reason: null, product: definition };
}

export function hasSubscriberProduct(entitlements = {}, product) {
  return subscriberProductAccess(entitlements, product).allowed;
}

export function enabledSubscriberProducts(entitlements = {}) {
  return SUBSCRIBER_PRODUCT_LIST.filter((product) => hasSubscriberProduct(entitlements, product.key));
}

export function subscriberProductForStationFamily(productFamily) {
  if (productFamily === "HEALTH") return "HEALTH";
  if (productFamily === "FAITH") return "FAITH";
  if (productFamily === "ORGANISATIONS") return "ORGANISATIONS";
  return "ONLINE";
}

export function hasAnySubscriberProduct(entitlements = {}) {
  return enabledSubscriberProducts(entitlements).length > 0;
}
