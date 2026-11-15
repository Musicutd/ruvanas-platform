import { z } from "zod";
import { rewardIdSchema, REWARDS_ACTIONS } from "./contracts.mjs";
import { STAFF_ADMIN_ROLE_CAPABILITIES, staffAdminIsoSchema as iso, staffAdminVersionSchema as version } from "./staff-admin-contracts.mjs";
const actions = z.array(z.enum(REWARDS_ACTIONS)).min(1).max(8).refine(rows => new Set(rows).size === rows.length);
const grant = z.object({ id: rewardIdSchema, scope: z.enum(["ALL_LOCATIONS", "LOCATIONS"]), locationId: rewardIdSchema.nullable(),
  capabilities: actions, startsAt: iso, expiresAt: iso, revokedAt: iso.nullable() }).strict()
  .refine(row => row.scope === "ALL_LOCATIONS" ? row.locationId === null : row.locationId !== null);
const member = z.object({ id: rewardIdSchema, displayName: z.string().min(1).max(200), role: z.enum(Object.keys(STAFF_ADMIN_ROLE_CAPABILITIES)),
  allowedCapabilities: actions, version, grants: z.array(grant).max(1000), usesSeat: z.boolean() }).strict()
  .refine(row => JSON.stringify(row.allowedCapabilities) === JSON.stringify(STAFF_ADMIN_ROLE_CAPABILITIES[row.role]));
const named = z.object({ id: rewardIdSchema, name: z.string().min(1).max(200) }).strict();
const overview = z.object({ ok: z.literal(true), organisation: named, members: z.array(member).max(100), locations: z.array(named).max(100),
  seatUsage: z.object({ used: z.number().int().min(0).max(100), limit: z.number().int().min(0).max(1_000_000_000) }).strict(),
  grantExpiresAt: iso, checkedAt: iso }).strict();
const mutation = z.object({ ok: z.literal(true), memberId: rewardIdSchema, version,
  changedRows: z.number().int().min(0).max(1020), checkedAt: iso }).strict();
export function safeStaffAdminResult(operation, value) {
  const schema = operation === "overview" ? overview : ["save", "revoke"].includes(operation) ? mutation : null;
  const parsed = schema?.safeParse(value); return parsed?.success ? parsed.data : null;
}
