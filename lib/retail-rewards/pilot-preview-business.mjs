import { readPilotPreviewPolicy } from "./pilot-preview-policy.mjs";
import { rewardIdSchema } from "./contracts.mjs";

const roles = new Set(["OWNER", "MANAGER", "CONTENT_EDITOR", "VIEWER"]);
export function pilotBusinessLanding(role) {
  return role === "SUPER_ADMIN" ? "/admin/retail-rewards/pilot" : role === "VIEWER" ?
    "/dashboard/retail/rewards/redeem" : "/dashboard/retail/rewards";
}

// Called only by explicitly scoped Rewards adapters. Ordinary app session
// lookup continues rejecting these accounts while private preview is enabled.
export function pilotPreviewBusinessIdentity(session, env = {}) {
  const policy = readPilotPreviewPolicy(env), user = session?.user;
  if (!policy.enabled || !["PASSWORD", "SSO"].includes(session?.authMethod) || !user ||
      !rewardIdSchema.safeParse(user.id).success || session.userId !== user.id || user.privatePreviewAccess != null) return null;
  if (user.role === "SUPER_ADMIN") return { userId: user.id, organisationId: null, role: user.role, landing: pilotBusinessLanding(user.role) };
  if (!roles.has(user.role) || !policy.organisationIds.includes(session.activeOrganisationId) || !Array.isArray(user.memberships)) return null;
  const members = user.memberships.filter(row => row.userId === user.id && row.organisationId === session.activeOrganisationId);
  if (members.length !== 1 || !roles.has(members[0].role)) return null;
  return { userId: user.id, organisationId: session.activeOrganisationId, role: members[0].role, landing: pilotBusinessLanding(members[0].role) };
}
