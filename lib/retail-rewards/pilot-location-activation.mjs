import { subscriberLocationAllowance } from "../subscriber-locations.mjs";
import { rewardIdSchema } from "./contracts.mjs";

const validId = value => rewardIdSchema.safeParse(value).success;
const finite = value => value instanceof Date && Number.isFinite(value.getTime());
const count = value => Number.isSafeInteger(value) && value >= 0;

/**
 * Called only inside pilot-admin-service's ReadCommitted, scoped Super Admin
 * transaction, after it locks the organisation, subscription and pilot authority.
 * Location.ACTIVE is shared with audio/device access, so this narrow transition
 * refuses any existing delivery configuration rather than enabling it indirectly.
 */
export async function activateRewardPilotLocation({
  tx, input, identity, now, readState, entitled, nowAt, abort
}) {
  const { organisationId, locationId, confirm } = input || {};
  if (!validId(organisationId) || !validId(locationId) || confirm !== true ||
      !validId(identity?.userId) || identity.organisationId !== organisationId || !finite(now)) abort("INVALID_REQUEST");

  // Organisation FOR UPDATE (held by the parent) blocks new Location FK
  // inserts. Lock existing tenant locations too so legacy status updates
  // cannot change capacity while it is checked. These are metadata locks,
  // never locks or writes against channels, encoders or unrelated tenants.
  const tenantLocations = await tx.$queryRaw`SELECT "id" FROM "Location"
    WHERE "organisationId" = ${organisationId} ORDER BY "id" LIMIT 1001 FOR SHARE`;
  if (tenantLocations.length > 1000 || tenantLocations.some(row => !validId(row.id)) ||
      new Set(tenantLocations.map(row => row.id)).size !== tenantLocations.length) abort("REVIEW_TOO_LARGE");
  if (!tenantLocations.some(row => row.id === locationId)) abort("LOCATION_UNAVAILABLE");

  const locked = await tx.$queryRaw`SELECT "id" FROM "Location"
    WHERE "id" = ${locationId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  if (locked.length !== 1 || locked[0].id !== locationId) abort("LOCATION_UNAVAILABLE");

  const location = await tx.location.findFirst({
    where: { id: locationId, organisationId },
    select: { id: true, organisationId: true, status: true, correctionsFacility: { select: { locationId: true } } }
  });
  if (!location || location.id !== locationId || location.organisationId !== organisationId ||
      !["DRAFT", "ACTIVE"].includes(location.status) || location.correctionsFacility !== null) abort("LOCATION_UNAVAILABLE");

  // Target Location/Zone locks prevent concurrent FK-based delivery setup.
  // ReadCommitted counts below also see inserts that committed before the
  // locks were acquired, including writers using ordinary ReadCommitted.
  const zones = await tx.$queryRaw`SELECT "id" FROM "Zone" WHERE "locationId" = ${locationId}
    ORDER BY "id" LIMIT 1001 FOR UPDATE`;
  if (!Array.isArray(zones) || zones.length > 1000 || zones.some(zone => !validId(zone.id)) ||
      new Set(zones.map(zone => zone.id)).size !== zones.length) abort("REVIEW_TOO_LARGE");
  const zoneScope = { zone: { locationId } };
  const [assignments, players, displays] = await Promise.all([
    tx.channelAssignment.count({ where: zoneScope }),
    tx.player.count({ where: zoneScope }),
    tx.digitalSignageDevice.count({ where: zoneScope })
  ]);
  // Even retired devices or ended assignments require the ordinary product
  // review, not this Rewards-only path. No delivery rows are edited or deleted.
  if ([assignments, players, displays].some(value => !count(value))) abort("UNAVAILABLE");
  if (assignments || players || displays) abort("CONFLICT");

  async function currentCapacity() {
    const state = await readState(tx, organisationId), instant = nowAt(now);
    const grant = entitled(state, organisationId, instant);
    const allowance = subscriberLocationAllowance(state.subscription, instant);
    if (!allowance.enabled || !Number.isSafeInteger(allowance.limit) || allowance.limit < 1 ||
        !grant || !Number.isSafeInteger(grant.limits?.locations) || grant.limits.locations < 1) abort("NOT_ENTITLED");
    const [physicalSites, rewardSites] = await Promise.all([
      tx.location.count({ where: { organisationId, status: { not: "CLOSED" }, correctionsFacility: { is: null } } }),
      tx.location.count({ where: { organisationId, status: { in: ["ACTIVE", "PAUSED"] }, correctionsFacility: { is: null } } })
    ]);
    if (!count(physicalSites) || physicalSites < 1 || !count(rewardSites) || rewardSites > physicalSites) abort("UNAVAILABLE");
    const finished = nowAt(now);
    entitled(state, organisationId, finished);
    const finalAllowance = subscriberLocationAllowance(state.subscription, finished);
    if (!finalAllowance.enabled || finalAllowance.limit !== allowance.limit) abort("NOT_ENTITLED");
    // DRAFT already reserves a physical site. Paused sites still reserve Rewards
    // capacity, so pausing cannot create a quota bypass.
    if (physicalSites > allowance.limit || rewardSites > grant.limits.locations) abort("LIMIT_REACHED");
    return { grant, rewardSites };
  }
  const capacity = await currentCapacity();
  if (location.status === "ACTIVE") return { ok: true, locationId, status: "ACTIVE" };
  if (capacity.rewardSites >= capacity.grant.limits.locations) abort("LIMIT_REACHED");

  const updated = await tx.location.updateMany({
    where: { id: locationId, organisationId, status: "DRAFT", correctionsFacility: { is: null } },
    data: { status: "ACTIVE" }
  });
  if (updated.count !== 1) abort("CONFLICT");
  await tx.auditLog.create({ data: {
    organisationId, actorUserId: identity.userId, action: "REWARDS_PILOT_LOCATION_ACTIVATED",
    entityType: "Location", entityId: locationId,
    details: { previousStatus: "DRAFT", status: "ACTIVE", purpose: "REWARDS_ONLY", audioChanged: false }
  } });
  // Expiry or a revoked authority must roll the transaction back even if the
  // transition/audit succeeded. The parent run() also repeats its session guard.
  await currentCapacity();
  return { ok: true, locationId, status: "ACTIVE" };
}
