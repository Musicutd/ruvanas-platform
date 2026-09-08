import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  addSubscriberZone,
  canManageSubscriberLocations,
  createSubscriberLocation,
  normalizeSubscriberLocationInput,
  renameSubscriberLocation,
  subscriberLocationAllowance
} from "../lib/subscriber-locations.mjs";

function subscription({ product = "RETAIL", limit = 3, status = "ACTIVE" } = {}) {
  return {
    status,
    retailRadioEnabled: null,
    schoolRadioEnabled: null,
    onlineRadioEnabled: null,
    plan: {
      active: true,
      code: `${product}_TEST`,
      stationLimit: limit,
      storageLimitGb: 5,
      listenerLimit: 100,
      maxBitrateKbps: 320,
      retailRadioEnabled: product === "RETAIL",
      schoolRadioEnabled: product === "SCHOOL",
      onlineRadioEnabled: product === "ONLINE",
      schoolPublicPublishingEnabled: false,
      retailMediaEnabled: product === "RETAIL",
      digitalSignageEnabled: product === "RETAIL",
      includesRuvanasCatalogue: false,
      licensedMusicCatalogueLevel: "NONE",
      promoUploadEnabled: false
    },
    billingContract: null
  };
}

function memoryDatabase({ product = "RETAIL", limit = 3, existing = 0 } = {}) {
  const locations = Array.from({ length: existing }, (_, index) => ({ id: `location-${index + 1}`, organisationId: "organisation-1", name: `Location ${index + 1}`, slug: `location-${index + 1}`, status: "ACTIVE", zones: [] }));
  const zones = [];
  const audits = [];
  const tx = {
    subscription: { async findUnique() { return subscription({ product, limit }); } },
    brand: { async findFirst({ where }) { return where.id === "brand-1" && where.organisationId === "organisation-1" ? { id: "brand-1" } : null; } },
    location: {
      async count({ where }) { return locations.filter((item) => item.organisationId === where.organisationId && item.status !== "CLOSED").length; },
      async findUnique({ where }) { return locations.find((item) => item.organisationId === where.organisationId_slug?.organisationId && item.slug === where.organisationId_slug?.slug) || null; },
      async findFirst({ where }) { return locations.find((item) => item.id === where.id && item.organisationId === where.organisationId) || null; },
      async create({ data }) {
        const zone = { id: `zone-${zones.length + 1}`, name: data.zones.create.name, slug: data.zones.create.slug, status: data.zones.create.status };
        zones.push({ ...zone, locationId: `location-${locations.length + 1}` });
        const location = { id: `location-${locations.length + 1}`, ...data, zones: [zone] };
        delete location.zones.create;
        locations.push(location);
        return location;
      },
      async update({ where, data }) { const item = locations.find((entry) => entry.id === where.id); Object.assign(item, data); return { id: item.id, name: item.name }; }
    },
    zone: {
      async findUnique({ where }) { return zones.find((item) => item.locationId === where.locationId_slug.locationId && item.slug === where.locationId_slug.slug) || null; },
      async create({ data }) { const zone = { id: `zone-${zones.length + 1}`, status: "ACTIVE", ...data }; zones.push(zone); return zone; }
    },
    auditLog: { async create({ data }) { audits.push(data); return data; } }
  };
  return { locations, zones, audits, async $transaction(operation, options) { assert.equal(options.isolationLevel, "Serializable"); return operation(tx); } };
}

test("Locations & Zones changes are restricted to owners and managers", () => {
  assert.equal(canManageSubscriberLocations("OWNER"), true);
  assert.equal(canManageSubscriberLocations("MANAGER"), true);
  assert.equal(canManageSubscriberLocations("CONTENT_EDITOR"), false);
  assert.equal(canManageSubscriberLocations("VIEWER"), false);
});

test("location input requires a real timezone and first area", () => {
  assert.deepEqual(normalizeSubscriberLocationInput({ name: " Valletta ", timezone: "Europe/Malta", firstZoneName: " Main floor ", countryCode: "mt" }).name, "Valletta");
  assert.throws(() => normalizeSubscriberLocationInput({ name: "Valletta", timezone: "Mars/Base", firstZoneName: "Main floor" }), /valid IANA timezone/);
  assert.throws(() => normalizeSubscriberLocationInput({ name: "Valletta", timezone: "Europe/Malta", firstZoneName: "" }), /first area/i);
});

test("physical products use the existing station limit while Online-only remains independent", () => {
  assert.deepEqual(subscriberLocationAllowance(subscription({ product: "RETAIL", limit: 3 })), { enabled: true, physicalProduct: true, limit: 3, reason: null });
  assert.deepEqual(subscriberLocationAllowance(subscription({ product: "SCHOOL", limit: 1 })), { enabled: true, physicalProduct: true, limit: 1, reason: null });
  assert.deepEqual(subscriberLocationAllowance(subscription({ product: "ONLINE", limit: 10 })), { enabled: false, physicalProduct: false, limit: 0, reason: "ONLINE_ONLY" });
});

test("owner creation is tenant scoped, creates its first area, audits, and does not touch billing", async () => {
  const database = memoryDatabase({ limit: 2 });
  const result = await createSubscriberLocation(database, { organisationId: "organisation-1", actorUserId: "owner-1", input: { name: "Valletta", timezone: "Europe/Malta", firstZoneName: "Main floor", brandId: "brand-1", addressLine1: "Private address is not audited" } });
  assert.equal(result.ok, true);
  assert.equal(result.location.zones[0].name, "Main floor");
  assert.equal(database.audits[0].action, "SUBSCRIBER_LOCATION_CREATED");
  assert.equal(database.audits[0].organisationId, "organisation-1");
  assert.equal(Object.hasOwn(database.audits[0].details, "addressLine1"), false);
});

test("location allowance and foreign brand boundaries are enforced", async () => {
  const full = await createSubscriberLocation(memoryDatabase({ limit: 1, existing: 1 }), { organisationId: "organisation-1", actorUserId: "owner-1", input: { name: "Second", timezone: "Europe/Malta", firstZoneName: "Main" } });
  assert.equal(full.status, 409);
  const foreignBrand = await createSubscriberLocation(memoryDatabase(), { organisationId: "organisation-1", actorUserId: "owner-1", input: { name: "Second", timezone: "Europe/Malta", firstZoneName: "Main", brandId: "brand-other" } });
  assert.equal(foreignBrand.status, 400);
});

test("areas can only be added to a location in the active organisation and renames keep stable ids", async () => {
  const database = memoryDatabase({ existing: 1 });
  const foreign = await addSubscriberZone(database, { organisationId: "organisation-2", locationId: "location-1", actorUserId: "manager-1", input: { name: "Terrace" } });
  assert.equal(foreign.status, 404);
  const added = await addSubscriberZone(database, { organisationId: "organisation-1", locationId: "location-1", actorUserId: "manager-1", input: { name: "Terrace" } });
  assert.equal(added.ok, true);
  const renamed = await renameSubscriberLocation(database, { organisationId: "organisation-1", locationId: "location-1", actorUserId: "manager-1", name: "Valletta flagship" });
  assert.deepEqual(renamed.location, { id: "location-1", name: "Valletta flagship" });
});

test("corrective UI captures stable forms and gives guided zero-location paths", async () => {
  const [signage, players, subscriberPage] = await Promise.all([
    readFile(new URL("../app/admin/digital-signage/DigitalSignageConsole.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/players/PlayerSetupClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/locations/page.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(signage, /event\.currentTarget\.reset\(\)/);
  assert.equal((signage.match(/const form = event\.currentTarget;/g) || []).length, 5);
  assert.match(signage, /Before adding a display, create the location and area where this screen will operate\./);
  assert.match(signage, /Create location \/ area/);
  assert.match(players, /No locations or playback areas have been created yet\./);
  assert.match(players, /Create your first location/);
  assert.match(subscriberPage, /canManageSubscriberLocations/);
});
