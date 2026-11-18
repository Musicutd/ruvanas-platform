import { readPrivatePreviewPolicy } from "../private-preview-policy.mjs";
import { readPilotAdminPolicy } from "./pilot-admin-contracts.mjs";
import { rewardIdSchema } from "./contracts.mjs";

const OFF = Object.freeze({ enabled: false, valid: false, organisationIds: Object.freeze([]) });

// A separate, default-off bridge. It neither turns Rewards on nor relaxes the
// existing private-preview policy or exact pilot organisation allowlist.
export function readPilotPreviewPolicy(env = {}) {
  try {
    const flag = env.RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED;
    if (![undefined, "false", "true"].includes(flag)) return OFF;
    const preview = readPrivatePreviewPolicy(env), pilot = readPilotAdminPolicy(env);
    if (!preview.valid || !pilot.valid) return OFF;
    const enabled = flag === "true" && preview.enabled && pilot.enabled;
    return Object.freeze({ enabled, valid: true,
      organisationIds: Object.freeze(enabled ? [...pilot.organisationIds] : []) });
  } catch { return OFF; }
}

// null means ordinary non-preview operation, never an unrestricted pilot.
// Empty scope fails closed when preview is on and the bridge is unavailable.
export function pilotPreviewOrganisationIds(env = {}) {
  try {
    const preview = readPrivatePreviewPolicy(env);
    if (!preview.enabled && preview.valid) return null;
    const policy = readPilotPreviewPolicy(env);
    return policy.enabled ? policy.organisationIds : [];
  } catch { return []; }
}

export function pilotPreviewOrganisationAllowed(env, organisationId) {
  const scope = pilotPreviewOrganisationIds(env);
  return scope === null || (rewardIdSchema.safeParse(organisationId).success && scope.includes(organisationId));
}

export function pilotPreviewOrganisationWhere(env) {
  const scope = pilotPreviewOrganisationIds(env);
  return scope === null ? {} : { organisationId: { in: [...scope] } };
}
