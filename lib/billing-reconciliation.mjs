import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PROVIDERS = new Set(["MANUAL", "GENERIC_HMAC"]);
const SUBSCRIPTION_STATUS_MAP = new Map([
  ["trial", "TRIAL"],
  ["trialing", "TRIAL"],
  ["active", "ACTIVE"],
  ["past_due", "PAST_DUE"],
  ["past-due", "PAST_DUE"],
  ["unpaid", "SUSPENDED"],
  ["suspended", "SUSPENDED"],
  ["cancelled", "CANCELLED"],
  ["canceled", "CANCELLED"]
]);

export function normaliseBillingProvider(value) {
  const provider = String(value || "").trim().toUpperCase();
  return PROVIDERS.has(provider) ? provider : null;
}

export function mapProviderSubscriptionStatus(value) {
  return SUBSCRIPTION_STATUS_MAP.get(
    String(value || "").trim().toLowerCase()
  ) || null;
}

export function hashBillingPayload(rawBody) {
  return createHash("sha256").update(String(rawBody || ""), "utf8").digest("hex");
}

export function signBillingWebhook(rawBody, secret) {
  if (!secret) throw new Error("A billing webhook secret is required.");
  return createHmac("sha256", secret)
    .update(String(rawBody || ""), "utf8")
    .digest("hex");
}

export function verifyBillingWebhookSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const supplied = String(signature).trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = Buffer.from(signBillingWebhook(rawBody, secret), "hex");
  const actual = Buffer.from(supplied, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function billingWebhookIdempotencyKey(provider, eventId) {
  const normalisedProvider = normaliseBillingProvider(provider);
  const normalisedEventId = String(eventId || "").trim();
  if (!normalisedProvider || !normalisedEventId) return null;
  return `${normalisedProvider}:${normalisedEventId}`;
}

export function resolveBillingServiceState(subscription, now = new Date()) {
  if (!subscription?.plan?.active) {
    return {
      serviceEnabled: false,
      reason: subscription ? "PLAN_INACTIVE" : "SUBSCRIPTION_MISSING",
      graceEndsAt: null
    };
  }

  if (["TRIAL", "ACTIVE"].includes(subscription.status)) {
    return { serviceEnabled: true, reason: subscription.status, graceEndsAt: null };
  }

  if (subscription.status === "PAST_DUE") {
    const graceEndsAt = subscription.billingContract?.graceEndsAt
      ? new Date(subscription.billingContract.graceEndsAt)
      : null;

    // Existing subscriptions pre-date Stage 5D. Preserve their present access
    // until an explicit billing contract and grace deadline are attached.
    if (!graceEndsAt || Number.isNaN(graceEndsAt.getTime())) {
      return {
        serviceEnabled: true,
        reason: "LEGACY_PAST_DUE_ACCESS",
        graceEndsAt: null
      };
    }

    const withinGrace = graceEndsAt.getTime() >= new Date(now).getTime();
    return {
      serviceEnabled: withinGrace,
      reason: withinGrace ? "PAYMENT_GRACE_PERIOD" : "PAYMENT_GRACE_EXPIRED",
      graceEndsAt
    };
  }

  return {
    serviceEnabled: false,
    reason: subscription.status || "SUBSCRIPTION_DISABLED",
    graceEndsAt: null
  };
}

function safeCount(value) {
  const count = Number(value || 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function buildBillingUsageSnapshot({
  locationCount,
  zoneCount,
  stationCount,
  storageBytes,
  schoolRadioEnabled
}) {
  const storage = typeof storageBytes === "bigint"
    ? storageBytes
    : BigInt(String(storageBytes || 0));
  return {
    locationCount: safeCount(locationCount),
    zoneCount: safeCount(zoneCount),
    stationCount: safeCount(stationCount),
    storageBytes: storage < 0n ? "0" : storage.toString(),
    schoolRadioEnabled: Boolean(schoolRadioEnabled)
  };
}

export function compareBillingUsage(platformUsage, providerUsage) {
  if (!providerUsage) return { status: "PENDING", discrepancies: [] };

  const expected = buildBillingUsageSnapshot(providerUsage);
  const actual = buildBillingUsageSnapshot(platformUsage);
  const discrepancies = [];
  for (const field of [
    "locationCount",
    "zoneCount",
    "stationCount",
    "storageBytes",
    "schoolRadioEnabled"
  ]) {
    if (actual[field] !== expected[field]) {
      discrepancies.push({
        field,
        platformValue: actual[field],
        providerValue: expected[field]
      });
    }
  }
  return {
    status: discrepancies.length === 0 ? "MATCHED" : "MISMATCHED",
    discrepancies
  };
}

