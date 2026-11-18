import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { readPilotAdminPolicy } from "./pilot-admin-contracts.mjs";
import { rewardsDenied } from "./errors.mjs";
import { pilotPreviewAdminIdentity } from "./pilot-preview-admin.mjs";

const finiteDate = z.date().refine(value => Number.isFinite(value.getTime()));
const sessionSchema = z.object({ id: rewardIdSchema, userId: rewardIdSchema,
  expiresAt: finiteDate, revokedAt: z.null(), authMethod: z.enum(["PASSWORD", "SSO", "PREVIEW_PASSWORD"]) });

// This separate Super Admin boundary grants no ordinary merchant or shopper
// bypass. Every caller supplies a fresh server-loaded session and user.
export async function requirePilotAdminAccess({ env = {}, loadContext, clock = () => new Date(), organisationId, previous } = {}) {
  try {
    const policy = readPilotAdminPolicy(env);
    if (!policy.enabled) return rewardsDenied("FEATURE_DISABLED");
    if (organisationId !== undefined && (!rewardIdSchema.safeParse(organisationId).success || !policy.organisationIds.includes(organisationId))) return rewardsDenied("FORBIDDEN");
    if (typeof loadContext !== "function") return rewardsDenied("UNAUTHENTICATED");
    const now = clock(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return rewardsDenied("UNAVAILABLE");
    const context = await loadContext(), parsed = sessionSchema.safeParse(context?.session);
    const checked = clock(); if (!(checked instanceof Date) || !Number.isFinite(checked.getTime()) || checked < now) return rewardsDenied("UNAVAILABLE");
    if (!parsed.success || parsed.data.expiresAt <= checked || context.user?.id !== parsed.data.userId) return rewardsDenied("UNAUTHENTICATED");
    if (context.user.role !== "SUPER_ADMIN") return rewardsDenied("FORBIDDEN");
    if (parsed.data.authMethod === "PREVIEW_PASSWORD") {
      if (!pilotPreviewAdminIdentity({ ...context.session, user: context.user }, env, checked)) return rewardsDenied("FORBIDDEN");
    } else if (context.user.privatePreviewAccess != null) return rewardsDenied("FORBIDDEN");
    const again = readPilotAdminPolicy(env);
    if (!again.enabled) return rewardsDenied("FEATURE_DISABLED");
    if (organisationId !== undefined && !again.organisationIds.includes(organisationId)) return rewardsDenied("FORBIDDEN");
    const access = { ok: true, userId: context.user.id, sessionId: parsed.data.id, organisationId: organisationId ?? null, authMethod: parsed.data.authMethod };
    if (previous && (previous.userId !== access.userId || previous.sessionId !== access.sessionId || previous.organisationId !== access.organisationId ||
        previous.authMethod !== access.authMethod)) return rewardsDenied("FORBIDDEN");
    return Object.freeze(access);
  } catch { return rewardsDenied("UNAVAILABLE"); }
}
