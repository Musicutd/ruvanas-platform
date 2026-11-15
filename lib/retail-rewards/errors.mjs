const ERRORS = Object.freeze({
  FEATURE_DISABLED: [403, "Retail Rewards is not available."],
  INVALID_REQUEST: [400, "The Rewards request is invalid."],
  UNAUTHENTICATED: [401, "Please sign in again."],
  AUTH_FAILED: [401, "The shopper sign-in details are not available or are incorrect."],
  INVITATION_UNAVAILABLE: [400, "This shopper invitation is not available."],
  CLAIM_UNAVAILABLE: [404, "This coupon is not available."],
  CLAIM_EXPIRED: [409, "This coupon or checkout code has expired."],
  ALREADY_REDEEMED: [409, "This coupon has already been redeemed."],
  REDEMPTION_UNAVAILABLE: [404, "This receipt is not available."],
  ALREADY_REVERSED: [409, "This redemption has already been corrected."],
  REVERSAL_WINDOW_CLOSED: [409, "The correction window for this redemption has closed."],
  REPORT_TOO_LARGE: [409, "This report contains too much activity. Choose a shorter date range."],
  REPORT_EXPIRED: [409, "This report is out of date. Refresh it before continuing or exporting."],
  REVIEW_TOO_LARGE: [409, "There are too many candidates for this review. Ask your administrator to narrow the published selection."],
  FORBIDDEN: [403, "You do not have permission for this Rewards action."],
  NOT_ENTITLED: [403, "Retail Rewards access is not available for this organisation."],
  LOCATION_UNAVAILABLE: [404, "This location is not available for this Rewards action."],
  OFFER_UNAVAILABLE: [404, "This offer is not available for this Rewards action."],
  CONFLICT: [409, "This offer has changed or the action is no longer available. Refresh before trying again."],
  LIMIT_REACHED: [409, "The approved Rewards limit has been reached."],
  UNAVAILABLE: [503, "Retail Rewards is temporarily unavailable."]
});

// Do not pass database errors, identifiers, credentials or stack traces through
// this response contract. Missing/foreign locations share one response.
export function rewardsDenied(code) {
  const safeCode = typeof code === "string" && Object.hasOwn(ERRORS, code) ? code : "UNAVAILABLE";
  const [status, error] = ERRORS[safeCode];
  return Object.freeze({ ok: false, status, code: safeCode, error });
}
