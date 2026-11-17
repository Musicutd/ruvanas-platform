import assert from "node:assert/strict";
import test from "node:test";
import { REVERSAL_REASON_OPTIONS, reversalMessage, reversalReasonLabel, reversalWindowOpen } from "../lib/retail-rewards/reversal-ui.mjs";

test("correction reasons are fixed labels, never arbitrary input", () => {
  assert.deepEqual(REVERSAL_REASON_OPTIONS.map(option => option.value), ["WRONG_COUPON", "PURCHASE_CANCELLED", "DUPLICATE_CHECKOUT"]);
  assert.equal(reversalReasonLabel("WRONG_COUPON"), "Wrong coupon was used");
  assert.equal(reversalReasonLabel("<script>private</script>"), "Correction recorded");
});
test("local correction affordance requires server eligibility and closes at the exact deadline", () => {
  const now = Date.parse("2026-11-14T12:00:00Z"), review = { canReverse: true, receipt: { reversal: null }, deadline: new Date(now + 1).toISOString() };
  assert.equal(reversalWindowOpen(review, now), true);
  assert.equal(reversalWindowOpen(review, now + 1), false);
  assert.equal(reversalWindowOpen({ ...review, canReverse: false }, now), false);
  assert.equal(reversalWindowOpen({ ...review, receipt: { reversal: { id: "existing" } } }, now), false);
  assert.equal(reversalWindowOpen({ ...review, deadline: "invalid" }, now), false);
});
test("correction errors are fixed messages with no service detail exposure", () => {
  assert.match(reversalMessage("REVERSAL_WINDOW_CLOSED"), /24-hour correction window/);
  assert.match(reversalMessage("ALREADY_REVERSED"), /already been corrected/);
  assert.match(reversalMessage("FORBIDDEN"), /permission/);
  assert.doesNotMatch(reversalMessage("private-secret"), /private-secret/);
});
