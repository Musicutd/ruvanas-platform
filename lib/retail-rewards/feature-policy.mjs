const OFF = Object.freeze({ enabled: false, publicClaimsEnabled: false, valid: false });

// Server composition must explicitly supply its environment. Importing this
// policy reads no process state and missing configuration cannot enable it.
export function readRewardsFeaturePolicy(env = {}) {
  try {
    if (!env || typeof env !== "object" || Array.isArray(env)) return OFF;
    const enabled = env.RUVANAS_RETAIL_REWARDS_ENABLED;
    const publicClaims = env.RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED;
    const valid = (value) => value === undefined || value === "false" || value === "true";
    if (!valid(enabled) || !valid(publicClaims)) return OFF;
    return Object.freeze({
      enabled: enabled === "true",
      publicClaimsEnabled: enabled === "true" && publicClaims === "true",
      valid: true
    });
  } catch {
    return OFF;
  }
}
