const ERRORS = Object.freeze({
  FEATURE_DISABLED: [403, "Retail Rewards is not available."],
  INVALID_REQUEST: [400, "The Rewards request is invalid."],
  UNAUTHENTICATED: [401, "Please sign in again."],
  FORBIDDEN: [403, "You do not have permission for this Rewards action."],
  NOT_ENTITLED: [403, "Retail Rewards access is not available for this organisation."],
  LOCATION_UNAVAILABLE: [404, "This location is not available for this Rewards action."],
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
