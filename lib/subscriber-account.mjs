const INVOICE_STATUS = Object.freeze({
  DRAFT: { label: "Preparing", tone: "neutral" },
  OPEN: { label: "Payment due", tone: "attention" },
  PAID: { label: "Paid", tone: "positive" },
  VOID: { label: "Cancelled", tone: "neutral" },
  UNCOLLECTIBLE: { label: "Needs support", tone: "attention" }
});

const ACCESS_REASON = Object.freeze({
  COMPLIMENTARY_ACCESS: {
    label: "Complimentary access",
    tone: "positive",
    description: "Your Ruvanas-issued service access is active without charge until Ruvanas ends the arrangement."
  },
  ACTIVE: {
    label: "Active",
    tone: "positive",
    description: "Your subscribed services and plan allowances are available."
  },
  TRIAL: {
    label: "Trial active",
    tone: "positive",
    description: "Your trial services and current plan allowances are available."
  },
  PAYMENT_GRACE_PERIOD: {
    label: "Payment attention",
    tone: "attention",
    description: "Your service remains available during the current payment grace period."
  },
  LEGACY_PAST_DUE_ACCESS: {
    label: "Payment attention",
    tone: "attention",
    description: "Your service remains available, but the account needs a billing review."
  },
  PAYMENT_GRACE_EXPIRED: {
    label: "Access paused",
    tone: "critical",
    description: "Service access is paused. Contact Ruvanas to review the account."
  },
  PLAN_INACTIVE: {
    label: "Plan unavailable",
    tone: "critical",
    description: "The selected plan is no longer available. Contact Ruvanas for assistance."
  },
  SUBSCRIPTION_MISSING: {
    label: "Plan required",
    tone: "critical",
    description: "A service plan must be assigned before radio tools can be used."
  },
  SUSPENDED: {
    label: "Access paused",
    tone: "critical",
    description: "Service access is paused. Contact Ruvanas for assistance."
  },
  CANCELLED: {
    label: "Ended",
    tone: "critical",
    description: "This subscription has ended. Contact Ruvanas to restart service."
  }
});

export function canViewSubscriberBilling(role) {
  return String(role || "").toUpperCase() === "OWNER";
}

export function subscriberAccessPresentation(entitlements = {}) {
  const reason = String(entitlements.accessReason || entitlements.subscriptionStatus || "SUBSCRIPTION_MISSING").toUpperCase();
  return ACCESS_REASON[reason] || {
    label: entitlements.serviceEnabled ? "Available" : "Needs attention",
    tone: entitlements.serviceEnabled ? "positive" : "critical",
    description: entitlements.serviceEnabled
      ? "Your subscribed services are currently available."
      : "Contact Ruvanas to review your service access."
  };
}

export function subscriberInvoicePresentation(invoice = {}) {
  const status = String(invoice.status || "DRAFT").toUpperCase();
  return INVOICE_STATUS[status] || { label: "Account record", tone: "neutral" };
}

export function formatSubscriberCurrency(amountCents, currency = "EUR", locale = "en-MT") {
  const cents = Number(amountCents);
  if (!Number.isSafeInteger(cents) || cents < 0) return "—";
  const safeCurrency = /^[A-Z]{3}$/.test(String(currency || "").toUpperCase())
    ? String(currency).toUpperCase()
    : "EUR";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2
  }).format(cents / 100);
}

export function subscriberUsageMeter(value, limit) {
  const safeValue = Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 0;
  return {
    value: safeValue,
    limit: safeLimit,
    percent: safeLimit ? Math.min(100, Math.round((safeValue / safeLimit) * 100)) : 0,
    exceeded: safeLimit > 0 && safeValue > safeLimit
  };
}

export function subscriberPlanFeatures(entitlements = {}) {
  return [
    { label: "Ruvanas Music Catalogue", enabled: Boolean(entitlements.includesRuvanasCatalogue) },
    { label: "Subscriber audio uploads", enabled: Boolean(entitlements.promoUploadEnabled) },
    { label: "School Radio", enabled: Boolean(entitlements.schoolRadioEnabled) },
    { label: "Public school publishing", enabled: Boolean(entitlements.schoolPublicPublishingEnabled) },
    { label: "Retail Media", enabled: Boolean(entitlements.retailMediaEnabled) },
    { label: "Digital Signage", enabled: Boolean(entitlements.digitalSignageEnabled) }
  ];
}
