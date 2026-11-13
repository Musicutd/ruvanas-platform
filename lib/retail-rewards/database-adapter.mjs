import { z } from "zod";
import { rewardGrantSchema, rewardIdSchema, rewardLimitsSchema,
  rewardProgramSchema, rewardStaffGrantSchema } from "./contracts.mjs";

const stateScopeSchema = z.object({ organisationId: rewardIdSchema, subscriptionId: rewardIdSchema }).strict();
const staffScopeSchema = z.object({ organisationId: rewardIdSchema, organisationMemberId: rewardIdSchema }).strict();
const locationScopeSchema = z.object({ organisationId: rewardIdSchema, locationId: rewardIdSchema }).strict();
const grantRowSchema = z.object({
  ...rewardGrantSchema.shape,
  ...rewardLimitsSchema.shape,
  limitsVersion: z.literal(1)
}).omit({ limits: true }).strict();
const staffRowSchema = z.object({
  ...rewardStaffGrantSchema.shape,
  locationId: rewardIdSchema.nullable()
}).omit({ locationIds: true }).strict().refine(row => row.scope === "ALL_LOCATIONS"
  ? row.locationId === null : row.locationId !== null);
const activeLocationSchema = z.object({
  id: rewardIdSchema, organisationId: rewardIdSchema, status: z.literal("ACTIVE")
}).strict();

const programSelect = Object.freeze({ id: true, organisationId: true, status: true });
const grantSelect = Object.freeze({
  id: true, organisationId: true, subscriptionId: true, capability: true,
  source: true, tier: true, status: true, startsAt: true, expiresAt: true,
  revokedAt: true, limitsVersion: true, activeOffers: true, locations: true,
  staffSeats: true, monthlyRedemptions: true, analyticsRetentionDays: true,
  exportEnabled: true, brandingEnabled: true
});
const staffSelect = Object.freeze({
  id: true, organisationId: true, organisationMemberId: true, capabilities: true,
  scope: true, locationId: true, startsAt: true, expiresAt: true, revokedAt: true
});
const locationSelect = Object.freeze({ id: true, organisationId: true, status: true });
const unavailable = () => new Error("Rewards database projection unavailable.");

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw unavailable();
  return result.data;
}

/** Read-only, tenant-filtered dependencies for the RR-01a policy guard.
 * Accepts an existing trusted Prisma client or transaction; never a request body.
 * Construction performs no database access. Missing records never create grants.
 * This is a preflight only: it reserves no quota and does not protect a later
 * write from concurrent changes. Future mutation services must recheck inside
 * their own transaction and enforce the returned locationScope on every query.
 */
export function createRewardsDatabaseAdapter(db) {
  return Object.freeze({
    async loadRewardsState(input) {
      const scope = parse(stateScopeSchema, input);
      const [programRow, grantRow] = await Promise.all([
        db.rewardProgram.findFirst({ where: { organisationId: scope.organisationId }, select: programSelect }),
        db.rewardEntitlementGrant.findFirst({ where: { ...scope }, select: grantSelect })
      ]);
      let program = null, grant = null;
      if (programRow !== null) {
        program = parse(rewardProgramSchema, programRow);
        if (program.organisationId !== scope.organisationId) throw unavailable();
      }
      if (grantRow !== null) {
        const row = parse(grantRowSchema, grantRow);
        if (row.organisationId !== scope.organisationId || row.subscriptionId !== scope.subscriptionId) throw unavailable();
        const { limitsVersion: _version, activeOffers, locations, staffSeats,
          monthlyRedemptions, analyticsRetentionDays, exportEnabled, brandingEnabled, ...authority } = row;
        grant = parse(rewardGrantSchema, { ...authority, limits: {
          activeOffers, locations, staffSeats, monthlyRedemptions,
          analyticsRetentionDays, exportEnabled, brandingEnabled
        } });
      }
      return { program, grant };
    },
    async loadStaffGrants(input) {
      const scope = parse(staffScopeSchema, input);
      const rows = await db.rewardStaffGrant.findMany({
        where: { ...scope }, select: staffSelect, orderBy: { id: "asc" }, take: 1001
      });
      // Never truncate authority to a seemingly valid partial result.
      if (!Array.isArray(rows) || rows.length > 1000) throw unavailable();
      const grants = rows.map(value => {
        const row = parse(staffRowSchema, value);
        if (row.organisationId !== scope.organisationId || row.organisationMemberId !== scope.organisationMemberId) throw unavailable();
        const { locationId, ...authority } = row;
        return parse(rewardStaffGrantSchema, {
          ...authority, locationIds: row.scope === "ALL_LOCATIONS" ? [] : [locationId]
        });
      });
      if (new Set(grants.map(row => row.id)).size !== grants.length) throw unavailable();
      return grants;
    },
    async loadLocation(input) {
      const scope = parse(locationScopeSchema, input);
      const row = await db.location.findFirst({
        where: { id: scope.locationId, organisationId: scope.organisationId, status: "ACTIVE" },
        select: locationSelect
      });
      const result = activeLocationSchema.safeParse(row);
      // Absent, foreign and inactive locations share the guard's 404 response.
      return result.success && result.data.id === scope.locationId && result.data.organisationId === scope.organisationId
        ? result.data : null;
    }
  });
}
