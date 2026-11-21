import { authorizeOrdinaryOwnerSession } from "../ordinary-owner-provisioning.mjs";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";
import { pilotPreparationDenied } from "./pilot-preparation-contracts.mjs";

// Platform administration only. Do not reuse or relax any pilot/merchant gate.
// The scoped service additionally requires durable internal-test provenance.
export function pilotPreparationIsClosed(env = {}) {
  const policy = readRewardsFeaturePolicy(env);
  return policy.valid && !policy.enabled;
}
export function authorizePilotPreparationSession(session, now, env = {}) {
  if (!pilotPreparationIsClosed(env)) return pilotPreparationDenied("PREPARATION_UNAVAILABLE");
  const access = authorizeOrdinaryOwnerSession(session, now, env);
  return access.ok ? access : pilotPreparationDenied(access.code);
}
export const PILOT_PREPARATION_SESSION_SELECT = Object.freeze({
  id: true, userId: true, authMethod: true, revokedAt: true, expiresAt: true, createdAt: true, lastSeenAt: true,
  user: { select: { id: true, email: true, role: true, privatePreviewAccess: { select: {
    userId: true, enabled: true, passwordEnabled: true, organisationId: true, expiresAt: true, pillars: true
  } } } },
  activeOrganisation: { select: { enterpriseSecurityPolicy: { select: { sessionMaxAgeMinutes: true, idleTimeoutMinutes: true } } } }
});
