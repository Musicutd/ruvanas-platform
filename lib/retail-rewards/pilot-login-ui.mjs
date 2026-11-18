const destinations = new Set([
  "/admin/retail-rewards/pilot",
  "/dashboard/retail/rewards",
  "/dashboard/retail/rewards/redeem"
]);

// This is presentation validation, not authentication. Never navigate to a
// server-supplied URL outside these three local Rewards workspaces.
export function pilotLoginDestination(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 2 && value.ok === true && destinations.has(value.landing)
    ? value.landing : null;
}

export function pilotLoginMessage(code) {
  return ({
    AUTH_FAILED: "We couldn’t sign you in. Check your business account details and pilot access.",
    UNAUTHENTICATED: "We couldn’t sign you in. Check your business account details and pilot access.",
    FORBIDDEN: "We couldn’t sign you in. Check your business account details and pilot access.",
    FEATURE_DISABLED: "Private Rewards pilot sign-in is unavailable right now.",
    INVALID_REQUEST: "Check your email, password and optional workspace ID, then try again.",
    RATE_LIMITED: "There have been too many attempts. Please wait before trying again."
  })[code] || "We couldn’t complete sign-in. Please try again shortly.";
}
