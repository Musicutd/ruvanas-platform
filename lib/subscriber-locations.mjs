import { resolveEntitlements } from "./entitlements.mjs";
import { isValidIanaTimezone } from "./opening-hours.mjs";
import { ORGANISATION_MANAGER_ROLES } from "./permissions.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

function cleanText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function optionalText(value, maximum) {
  return cleanText(value, maximum) || null;
}

export function makeLocationSlug(value) {
  return cleanText(value, 200)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function canManageSubscriberLocations(role) {
  return ORGANISATION_MANAGER_ROLES.includes(role);
}

export function subscriberLocationAllowance(subscription, instant = new Date()) {
  if (!subscription) return { enabled: false, physicalProduct: false, limit: 0, reason: "NO_SUBSCRIPTION" };
  const entitlements = resolveEntitlements(subscription, instant);
  const physicalProduct = entitlements.retailRadioEnabled || entitlements.schoolRadioEnabled || entitlements.healthRadioEnabled || entitlements.faithRadioEnabled;
  return {
    enabled: entitlements.serviceEnabled && physicalProduct,
    physicalProduct,
    limit: physicalProduct ? entitlements.stationLimit : 0,
    reason: !entitlements.serviceEnabled ? "SERVICE_INACTIVE" : physicalProduct ? null : "ONLINE_ONLY"
  };
}

export function normalizeSubscriberLocationInput(input = {}) {
  const name = cleanText(input.name, 160);
  const timezone = cleanText(input.timezone, 100);
  const firstZoneName = cleanText(input.firstZoneName, 160);
  const brandId = cleanText(input.brandId, 200) || null;
  const countryCode = cleanText(input.countryCode, 2).toUpperCase() || null;
  if (name.length < 2) throw new Error("Add a location name with at least two characters.");
  if (!isValidIanaTimezone(timezone)) throw new Error("Choose a valid IANA timezone, such as Europe/Malta.");
  if (firstZoneName.length < 2) throw new Error("Add the first area / zone with at least two characters.");
  if (!makeLocationSlug(name) || !makeLocationSlug(firstZoneName)) throw new Error("Location and area names must include letters or numbers supported in web addresses.");
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw new Error("Country must use a two-letter code.");
  return {
    name,
    slug: makeLocationSlug(name),
    timezone,
    firstZoneName,
    firstZoneSlug: makeLocationSlug(firstZoneName),
    brandId,
    addressLine1: optionalText(input.addressLine1, 200),
    addressLine2: optionalText(input.addressLine2, 200),
    city: optionalText(input.city, 120),
    region: optionalText(input.region, 120),
    postalCode: optionalText(input.postalCode, 40),
    countryCode
  };
}

export function normalizeSubscriberZoneInput(input = {}) {
  const name = cleanText(input.name, 160);
  if (name.length < 2) throw new Error("Add an area / zone name with at least two characters.");
  if (!makeLocationSlug(name)) throw new Error("Area / zone name must include letters or numbers supported in web addresses.");
  return { name, slug: makeLocationSlug(name) };
}

export async function createSubscriberLocation(database, { organisationId, actorUserId, input, instant = new Date() }) {
  let normalized;
  try { normalized = normalizeSubscriberLocationInput(input); }
  catch (error) { return { ok: false, status: 400, error: error.message }; }

  try {
    return await runSerializableTransaction(database, async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { organisationId },
        include: { plan: true, billingContract: true }
      });
      const allowance = subscriberLocationAllowance(subscription, instant);
      if (!allowance.enabled || allowance.limit < 1) {
        return { ok: false, status: 403, error: allowance.reason === "ONLINE_ONLY" ? "Locations & Zones are not required for this Online Radio service." : "Locations & Zones are unavailable for this subscription." };
      }
      const current = await tx.location.count({ where: { organisationId, status: { not: "CLOSED" } } });
      if (current >= allowance.limit) {
        return { ok: false, status: 409, error: `This plan already has ${allowance.limit} location${allowance.limit === 1 ? "" : "s"}. Contact support before adding another.`, current, limit: allowance.limit };
      }
      if (normalized.brandId) {
        const brand = await tx.brand.findFirst({ where: { id: normalized.brandId, organisationId }, select: { id: true } });
        if (!brand) return { ok: false, status: 400, error: "The selected brand is not part of this organisation." };
      }
      const duplicate = await tx.location.findUnique({ where: { organisationId_slug: { organisationId, slug: normalized.slug } }, select: { id: true } });
      if (duplicate) return { ok: false, status: 409, error: "A location with this name already exists." };
      const location = await tx.location.create({
        data: {
          organisationId,
          brandId: normalized.brandId,
          name: normalized.name,
          slug: normalized.slug,
          status: "ACTIVE",
          timezone: normalized.timezone,
          addressLine1: normalized.addressLine1,
          addressLine2: normalized.addressLine2,
          city: normalized.city,
          region: normalized.region,
          postalCode: normalized.postalCode,
          countryCode: normalized.countryCode,
          zones: { create: { name: normalized.firstZoneName, slug: normalized.firstZoneSlug, status: "ACTIVE" } }
        },
        include: { zones: { select: { id: true, name: true, slug: true, status: true } } }
      });
      await tx.auditLog.create({ data: {
        organisationId,
        actorUserId,
        action: "SUBSCRIBER_LOCATION_CREATED",
        entityType: "Location",
        entityId: location.id,
        details: { name: location.name, timezone: location.timezone, brandId: location.brandId, firstZoneId: location.zones[0]?.id || null }
      } });
      return { ok: true, status: 201, location, current: current + 1, limit: allowance.limit };
    });
  } catch (error) {
    if (error?.code === "P2002") return { ok: false, status: 409, error: "That location or area name is already in use." };
    throw error;
  }
}

export async function addSubscriberZone(database, { organisationId, locationId, actorUserId, input }) {
  let normalized;
  try { normalized = normalizeSubscriberZoneInput(input); }
  catch (error) { return { ok: false, status: 400, error: error.message }; }
  try {
    return await runSerializableTransaction(database, async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
      if (!subscriberLocationAllowance(subscription).enabled) return { ok: false, status: 403, error: "Locations & Zones are unavailable for this subscription." };
      const location = await tx.location.findFirst({ where: { id: locationId, organisationId, status: { not: "CLOSED" } }, select: { id: true } });
      if (!location) return { ok: false, status: 404, error: "Location not found in this organisation." };
      const duplicate = await tx.zone.findUnique({ where: { locationId_slug: { locationId, slug: normalized.slug } }, select: { id: true } });
      if (duplicate) return { ok: false, status: 409, error: "An area / zone with this name already exists at the location." };
      const zone = await tx.zone.create({ data: { locationId, name: normalized.name, slug: normalized.slug, status: "ACTIVE" } });
      await tx.auditLog.create({ data: { organisationId, actorUserId, action: "SUBSCRIBER_ZONE_CREATED", entityType: "Zone", entityId: zone.id, details: { locationId, name: zone.name } } });
      return { ok: true, status: 201, zone };
    });
  } catch (error) {
    if (error?.code === "P2002") return { ok: false, status: 409, error: "That area / zone name is already in use." };
    throw error;
  }
}

export async function renameSubscriberLocation(database, { organisationId, locationId, actorUserId, name }) {
  const normalizedName = cleanText(name, 160);
  if (normalizedName.length < 2) return { ok: false, status: 400, error: "Add a location name with at least two characters." };
  return runSerializableTransaction(database, async (tx) => {
    const subscription = await tx.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
    if (!subscriberLocationAllowance(subscription).enabled) return { ok: false, status: 403, error: "Locations & Zones are unavailable for this subscription." };
    const current = await tx.location.findFirst({ where: { id: locationId, organisationId }, select: { id: true, name: true } });
    if (!current) return { ok: false, status: 404, error: "Location not found in this organisation." };
    const location = await tx.location.update({ where: { id: current.id }, data: { name: normalizedName }, select: { id: true, name: true } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "SUBSCRIBER_LOCATION_RENAMED", entityType: "Location", entityId: location.id, details: { previousName: current.name, name: location.name } } });
    return { ok: true, status: 200, location };
  });
}

export async function renameSubscriberZone(database, { organisationId, locationId, zoneId, actorUserId, name }) {
  const normalizedName = cleanText(name, 160);
  if (normalizedName.length < 2) return { ok: false, status: 400, error: "Add an area / zone name with at least two characters." };
  return runSerializableTransaction(database, async (tx) => {
    const subscription = await tx.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
    if (!subscriberLocationAllowance(subscription).enabled) return { ok: false, status: 403, error: "Locations & Zones are unavailable for this subscription." };
    const current = await tx.zone.findFirst({ where: { id: zoneId, locationId, location: { organisationId } }, select: { id: true, name: true } });
    if (!current) return { ok: false, status: 404, error: "Area / zone not found in this organisation." };
    const zone = await tx.zone.update({ where: { id: current.id }, data: { name: normalizedName }, select: { id: true, name: true } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "SUBSCRIBER_ZONE_RENAMED", entityType: "Zone", entityId: zone.id, details: { locationId, previousName: current.name, name: zone.name } } });
    return { ok: true, status: 200, zone };
  });
}
