import { isPrivatePreviewAdminSession, readPrivatePreviewPolicy } from "../private-preview-policy.mjs";
import { readPilotPreviewPolicy } from "./pilot-preview-policy.mjs";
import { rewardIdSchema } from "./contracts.mjs";

const finite = value => value instanceof Date && Number.isFinite(value.getTime());

// Only the configured, established preview owner can reuse the existing admin
// session. This identity is consumed by ADMIN routes, never merchant/shopper
// authentication, and conveys no permission while any pilot gate is off.
export function pilotPreviewAdminIdentity(session, env = {}, now = new Date()) {
  try {
    if (!readPilotPreviewPolicy(env).enabled || !finite(now) ||
        !rewardIdSchema.safeParse(session?.id).success || !rewardIdSchema.safeParse(session?.userId).success ||
        session.user?.id !== session.userId || session.revokedAt !== null ||
        !finite(session.expiresAt) || session.expiresAt <= now ||
        !finite(session.createdAt) || session.createdAt > now ||
        !finite(session.lastSeenAt) || session.lastSeenAt > now ||
        !isPrivatePreviewAdminSession(session, readPrivatePreviewPolicy(env))) return null;
    const security = session.activeOrganisation?.enterpriseSecurityPolicy;
    if (security && (!Number.isInteger(security.sessionMaxAgeMinutes) || security.sessionMaxAgeMinutes <= 0 ||
        !Number.isInteger(security.idleTimeoutMinutes) || security.idleTimeoutMinutes <= 0 ||
        session.createdAt.getTime() + security.sessionMaxAgeMinutes * 60_000 <= now.getTime() ||
        session.lastSeenAt.getTime() + security.idleTimeoutMinutes * 60_000 <= now.getTime())) return null;
    return { userId: session.userId, organisationId: null, role: "SUPER_ADMIN", landing: "/admin/retail-rewards/pilot" };
  } catch { return null; }
}
