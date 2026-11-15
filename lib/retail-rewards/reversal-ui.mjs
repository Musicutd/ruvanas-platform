import { checkoutMessage } from "./checkout-ui.mjs";

export const REVERSAL_REASON_OPTIONS = Object.freeze([
  Object.freeze({ value: "WRONG_COUPON", label: "Wrong coupon was used" }),
  Object.freeze({ value: "PURCHASE_CANCELLED", label: "Purchase was cancelled" }),
  Object.freeze({ value: "DUPLICATE_CHECKOUT", label: "Duplicate checkout" })
]);
export function reversalReasonLabel(reason) {
  return REVERSAL_REASON_OPTIONS.find(option => option.value === reason)?.label || "Correction recorded";
}
export function reversalMessage(code) {
  return ({
    REDEMPTION_UNAVAILABLE: "This receipt is not available for correction at the selected shop. Check its confirmation ID and your shop access.",
    ALREADY_REVERSED: "This redemption has already been corrected. Review the receipt to see its correction.",
    REVERSAL_WINDOW_CLOSED: "The 24-hour correction window has ended. This receipt cannot be reversed here.",
    CONFLICT: "The correction request differs from an earlier request. Review the receipt before continuing."
  })[code] || checkoutMessage(code);
}
export function reversalWindowOpen(review, now = Date.now()) {
  return Boolean(review?.canReverse === true && review.receipt && !review.receipt.reversal &&
    Number.isFinite(Date.parse(review.deadline)) && Date.parse(review.deadline) > now);
}
