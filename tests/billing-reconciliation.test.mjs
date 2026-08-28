import test from "node:test";
import assert from "node:assert/strict";

import {
  billingWebhookIdempotencyKey,
  buildBillingUsageSnapshot,
  compareBillingUsage,
  hashBillingPayload,
  mapProviderSubscriptionStatus,
  signBillingWebhook,
  verifyBillingWebhookSignature
} from "../lib/billing-reconciliation.mjs";

test("billing webhook signatures authenticate the exact raw payload", () => {
  const body = JSON.stringify({ id: "event-1", type: "subscription.updated" });
  const secret = "a-secure-billing-secret-with-more-than-32-characters";
  const signature = signBillingWebhook(body, secret);

  assert.equal(verifyBillingWebhookSignature(body, `sha256=${signature}`, secret), true);
  assert.equal(verifyBillingWebhookSignature(`${body} `, signature, secret), false);
  assert.equal(verifyBillingWebhookSignature(body, "not-a-signature", secret), false);
  assert.equal(hashBillingPayload(body).length, 64);
});

test("provider event keys and subscription statuses are normalised", () => {
  assert.equal(
    billingWebhookIdempotencyKey("generic_hmac", " evt_123 "),
    "GENERIC_HMAC:evt_123"
  );
  assert.equal(mapProviderSubscriptionStatus("trialing"), "TRIAL");
  assert.equal(mapProviderSubscriptionStatus("past_due"), "PAST_DUE");
  assert.equal(mapProviderSubscriptionStatus("unpaid"), "SUSPENDED");
  assert.equal(mapProviderSubscriptionStatus("unknown"), null);
});

test("usage reconciliation identifies exact field differences", () => {
  const platform = buildBillingUsageSnapshot({
    locationCount: 3,
    zoneCount: 5,
    stationCount: 2,
    storageBytes: 1048576n,
    schoolRadioEnabled: true
  });

  assert.deepEqual(compareBillingUsage(platform, { ...platform }), {
    status: "MATCHED",
    discrepancies: []
  });

  const mismatch = compareBillingUsage(platform, {
    ...platform,
    zoneCount: 4,
    schoolRadioEnabled: false
  });
  assert.equal(mismatch.status, "MISMATCHED");
  assert.deepEqual(
    mismatch.discrepancies.map((item) => item.field),
    ["zoneCount", "schoolRadioEnabled"]
  );
});

test("usage without a provider statement remains pending", () => {
  assert.deepEqual(compareBillingUsage({ locationCount: 1 }, null), {
    status: "PENDING",
    discrepancies: []
  });
});

