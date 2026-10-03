import { resolveEntitlements } from "./entitlements.mjs";
import { subscriberProductAccess } from "./product-access.mjs";

// A route-level grant check is not sufficient for a request that may wait for
// its body. Lock the current member, location and grant at the mutation
// boundary so a committed downgrade or revocation cannot be followed by a
// facility write using stale request context.
export async function correctionsCurrentFacilityEdit(tx, { organisationId, memberId, facilityId, ownerOnly = false } = {}) {
  if (!organisationId || !memberId || !facilityId) return null;
  const members = await tx.$queryRaw`
    SELECT "role" FROM "OrganisationMember"
    WHERE "id" = ${memberId} AND "organisationId" = ${organisationId}
    FOR UPDATE
  `;
  const role = members[0]?.role;
  if (role !== "OWNER" && (ownerOnly || role !== "MANAGER")) return null;
  const locations = await tx.$queryRaw`
    SELECT "status" FROM "Location"
    WHERE "id" = ${facilityId} AND "organisationId" = ${organisationId}
    FOR UPDATE
  `;
  if (!locations.length || locations[0].status === "CLOSED") return null;
  const facility = await tx.correctionsFacility.findUnique({ where: { locationId: facilityId }, select: { locationId: true } });
  if (!facility) return null;
  if (role !== "OWNER") {
    const grants = await tx.$queryRaw`
      SELECT "permission" FROM "CorrectionsFacilityGrant"
      WHERE "organisationId" = ${organisationId}
        AND "organisationMemberId" = ${memberId}
        AND "facilityId" = ${facilityId}
      FOR UPDATE
    `;
    if (grants[0]?.permission !== "MANAGER") return null;
  }
  const subscriptions = await tx.$queryRaw`
    SELECT "planId" FROM "Subscription" WHERE "organisationId" = ${organisationId} FOR SHARE
  `;
  if (!subscriptions.length) return null;
  const plans = await tx.$queryRaw`
    SELECT "id" FROM "Plan" WHERE "id" = ${subscriptions[0].planId} FOR SHARE
  `;
  if (!plans.length) return null;
  const subscription = await tx.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
  const entitlements = resolveEntitlements(subscription);
  if (!subscriberProductAccess(entitlements, "CORRECTIONS").allowed) return null;
  return { role, entitlements };
}
