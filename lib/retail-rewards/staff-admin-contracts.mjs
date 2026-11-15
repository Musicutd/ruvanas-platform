import { z } from "zod";
import { rewardIdSchema, REWARDS_ACTIONS } from "./contracts.mjs";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";

export const STAFF_ADMIN_ROLE_CAPABILITIES = Object.freeze({
  MANAGER: Object.freeze(["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS", "REDEEM", "REVERSE", "VIEW_INSIGHTS", "EXPORT"]),
  CONTENT_EDITOR: Object.freeze(["READ", "MANAGE_OFFERS", "VIEW_INSIGHTS"]),
  VIEWER: Object.freeze(["READ", "REDEEM"])
});
export function readStaffAdminPolicy(env = {}) {
  try { return Object.freeze({ enabled: readRewardsFeaturePolicy(env).enabled && env.RUVANAS_RETAIL_REWARDS_STAFF_ADMIN_ENABLED === "true" }); }
  catch { return Object.freeze({ enabled: false }); }
}
export const staffAdminIsoSchema = z.string().datetime({ offset: false }).refine(value => {
  try { return new Date(value).toISOString() === value; } catch { return false; }
});
export const staffAdminVersionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const actions = z.array(z.enum(REWARDS_ACTIONS.filter(action => action !== "MANAGE_STAFF"))).min(1).max(7)
  .refine(values => new Set(values).size === values.length);
const target = { memberId: rewardIdSchema, expectedVersion: staffAdminVersionSchema, confirm: z.literal(true) };
export const staffAdminSchemas = Object.freeze({
  overview: z.object({}).strict(),
  save: z.object({ ...target, locationIds: z.array(rewardIdSchema).min(1).max(20).refine(values => new Set(values).size === values.length),
    capabilities: actions, expiresAt: staffAdminIsoSchema }).strict(),
  revoke: z.object(target).strict()
});
