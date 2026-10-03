import assert from "node:assert/strict";
import test from "node:test";
import { insideDemoFacilities } from "../lib/inside-demo-scenario.mjs";
import { findPublicPlan, publicPlanDatabaseData } from "../lib/product-plan-catalogue.mjs";
import { assertInsideDemoSyntheticDatabase } from "../scripts/assert-inside-demo-synthetic-database.mjs";

const tenantTables = [
  "AuditLog", "CorrectionsProfile", "CorrectionsProgramme", "Location", "MediaAsset",
  "OrganisationMember", "Player", "ProofOfPlayEvent", "Subscription"
];
const allowedGlobalTables = [
  "_prisma_migrations", "Plan", "Organisation", "User", "Zone",
  "CorrectionsFacility", "Session"
];
const orgId = "synthetic-organisation-id";
const ownerId = "synthetic-owner-id";
const draftDescription = "Fictional draft for exploring the review workflow. It contains no audio and cannot be broadcast.";

function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((item) => matches(row, item));
    if (key === "NOT") return !matches(row, condition);
    if (condition && typeof condition === "object") {
      if ("not" in condition) return row[key] !== condition.not;
      if ("notIn" in condition) return !condition.notIn.includes(row[key]);
    }
    return row[key] === condition;
  });
}

function select(row, selection) {
  return Object.fromEntries(Object.keys(selection).filter((key) => selection[key]).map((key) => [key, row[key]]));
}

function delegate(rows) {
  return {
    count: async ({ where } = {}) => rows.filter((row) => matches(row, where)).length,
    findUnique: async ({ where, select: fields }) => {
      const row = rows.find((item) => matches(item, where));
      return row ? select(row, fields) : null;
    },
    findMany: async ({ where, select: fields, take } = {}) => rows.filter((row) => matches(row, where))
      .slice(0, take).map((row) => fields ? select(row, fields) : row)
  };
}

function syntheticData() {
  const locations = insideDemoFacilities.map((facility) => ({
    id: `location-${facility.slug}`, organisationId: orgId, slug: facility.slug, name: facility.name,
    brandId: null, status: "ACTIVE", timezone: "Europe/Malta", countryCode: "MT",
    addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null
  }));
  return {
    organisations: [{ id: orgId, slug: "inside-synthetic-demo", name: "Synthetic Inside Demo Authority" }],
    users: [{ id: ownerId, email: "inside-demo-owner@example.invalid", name: "Inside Demo Owner", role: "OWNER" }],
    locations,
    zones: insideDemoFacilities.map((facility) => ({
      locationId: `location-${facility.slug}`, slug: "wing-one", name: facility.zone, status: "ACTIVE"
    })),
    programmes: [{ organisationId: orgId, facilityId: "location-demo-alpha",
      title: "Synthetic orientation programme", description: draftDescription, status: "DRAFT" }],
    plans: [{ id: "inside-plan", studioExternalDestinationLimit: null,
      ...publicPlanDatabaseData(findPublicPlan("CORRECTIONS_NETWORK", "CORRECTIONS")) }],
    memberships: [{ userId: ownerId, organisationId: orgId, role: "OWNER" }],
    subscriptions: [{ organisationId: orgId, planId: "inside-plan", status: "ACTIVE" }],
    correctionsProfiles: [{ organisationId: orgId, cleanOnly: true, policyVersion: 1, allowedGenres: [],
      restrictedGenres: [], blockedTrackIds: [], blockedArtists: [] }],
    correctionsFacilities: insideDemoFacilities.map((facility) => ({
      locationId: `location-${facility.slug}`, youthFacility: false,
      dualApprovalRequired: false, policyVersion: 1, allowedGenres: [],
      restrictedGenres: [], blockedTrackIds: [], blockedArtists: [],
      requestAvailability: "DISABLED", publicRequestCode: null,
      songRequestsEnabled: false, messageRequestsEnabled: false,
      dedicationsEnabled: false, announcementApprovalMode: "EXPLICIT",
      priorityEnabled: false, emergencyEnabled: false,
      emergencyDualControl: false, emergencyDrillsEnabled: false
    })),
    sessions: [{ userId: ownerId, activeOrganisationId: orgId }],
    auditLogs: [{ organisationId: orgId, actorUserId: ownerId,
      schoolNetworkId: null, stationNetworkId: null, actorServiceAccountId: null }],
    players: [], mediaAssets: [], proofs: [],
    tables: [...tenantTables.map((tableName) => ({ tableName, hasOrganisationId: true })),
      ...allowedGlobalTables.map((tableName) => ({ tableName, hasOrganisationId: false })),
      { tableName: "UnusedGlobal", hasOrganisationId: false }],
    tableRows: { Subscription: [orgId], OrganisationMember: [orgId],
      CorrectionsProfile: [orgId], CorrectionsProgramme: [orgId], Location: [orgId] }
  };
}

function database(data) {
  const queriedTables = [];
  return {
    organisation: delegate(data.organisations), user: delegate(data.users),
    location: delegate(data.locations), zone: delegate(data.zones),
    plan: delegate(data.plans), organisationMember: delegate(data.memberships),
    subscription: delegate(data.subscriptions), correctionsProfile: delegate(data.correctionsProfiles),
    correctionsProgramme: delegate(data.programmes), correctionsFacility: delegate(data.correctionsFacilities),
    session: delegate(data.sessions),
    auditLog: delegate(data.auditLogs), player: delegate(data.players),
    mediaAsset: delegate(data.mediaAssets), proofOfPlayEvent: delegate(data.proofs),
    $queryRaw: async (parts) => {
      assert.match(parts.join(""), /information_schema\.tables/);
      return data.tables;
    },
    $queryRawUnsafe: async (sql, expectedOrganisationId) => {
      const tableName = /FROM "public"\."([A-Za-z_][A-Za-z0-9_]*)"/.exec(sql)?.[1];
      assert.ok(tableName);
      queriedTables.push(tableName);
      if (sql.includes("WHERE")) {
        assert.match(sql, /"organisationId" IS NOT NULL AND "organisationId" <> \$1/);
        return [{ hasUnexpected: (data.tableRows[tableName] || [])
          .some((value) => value !== null && value !== expectedOrganisationId) }];
      }
      assert.equal(expectedOrganisationId, undefined);
      return [{ hasUnexpected: (data.tableRows[tableName] || []).length > 0 }];
    },
    queriedTables
  };
}

test("empty named demo database passes without writing or revealing records", async () => {
  const data = syntheticData();
  for (const key of ["organisations", "users", "locations", "zones", "programmes", "plans",
    "memberships", "subscriptions", "correctionsProfiles", "correctionsFacilities", "sessions", "auditLogs"]) data[key] = [];
  data.tableRows = {};
  const db = database(data);
  await assertInsideDemoSyntheticDatabase(db);
  assert.deepEqual(db.queriedTables.sort(), [...tenantTables, "UnusedGlobal"].sort());
});

test("existing fictional seed plus owner session and audit event passes", async () => {
  const db = database(syntheticData());
  await assertInsideDemoSyntheticDatabase(db);
  assert.equal(db.queriedTables.length, tenantTables.length + 1);
});

for (const [label, change] of [
  ["another organisation", (data) => data.organisations.push({ id: "other", slug: "customer", name: "Customer" })],
  ["another user", (data) => data.users.push({ id: "other", email: "customer@example.invalid", name: "Customer", role: "OWNER" })],
  ["changed demo owner identity", (data) => { data.users[0].name = "Unknown"; }],
  ["another facility", (data) => data.locations.push({ id: "other", organisationId: orgId, slug: "real", name: "Other" })],
  ["changed facility label", (data) => { data.locations[0].name = "Other"; }],
  ...Object.entries({ brandId: "brand", status: "DRAFT", timezone: "Europe/London",
    countryCode: "GB", addressLine1: "Street", addressLine2: "Suite", city: "City",
    region: "Region", postalCode: "CODE" }).map(([field, value]) =>
    [`unexpected facility ${field}`, (data) => { data.locations[0][field] = value; }]),
  ["another zone", (data) => data.zones.push({ locationId: "location-demo-alpha", slug: "two", name: "Other" })],
  ["inactive zone", (data) => { data.zones[0].status = "INACTIVE"; }],
  ["unknown Corrections facility", (data) => data.correctionsFacilities.push({ locationId: "other" })],
  ...Object.entries({ youthFacility: true, dualApprovalRequired: true, policyVersion: 2,
    allowedGenres: ["other"], restrictedGenres: ["other"], blockedTrackIds: ["other"],
    blockedArtists: ["other"], requestAvailability: "OPEN", publicRequestCode: "CODE",
    songRequestsEnabled: true, messageRequestsEnabled: true, dedicationsEnabled: true,
    announcementApprovalMode: "AUTO", priorityEnabled: true, emergencyEnabled: true,
    emergencyDualControl: true, emergencyDrillsEnabled: true }).map(([field, value]) =>
    [`unexpected Corrections facility ${field}`, (data) => { data.correctionsFacilities[0][field] = value; }]),
  ["another programme", (data) => data.programmes.push({ organisationId: orgId, facilityId: "location-demo-alpha", title: "Other", status: "DRAFT" })],
  ["unlisted plan", (data) => data.plans.push({ id: "unknown", code: "PRIVATE_UNKNOWN" })],
  ["altered plan entitlement", (data) => { data.plans[0].correctionsRadioEnabled = false; }],
  ["altered plan tier", (data) => { data.plans[0].tierNumber = 5; }],
  ["foreign membership", (data) => data.memberships.push({ userId: "other", organisationId: orgId, role: "OWNER" })],
  ["other subscription", (data) => data.subscriptions.push({ organisationId: "other", planId: "inside-plan", status: "ACTIVE" })],
  ["changed Corrections profile", (data) => { data.correctionsProfiles[0].blockedArtists.push("Other"); }],
  ["changed Corrections profile version", (data) => { data.correctionsProfiles[0].policyVersion = 2; }],
  ["foreign owner session", (data) => data.sessions.push({ userId: "other", activeOrganisationId: orgId })],
  ["foreign audit actor", (data) => data.auditLogs.push({ organisationId: orgId, actorUserId: "other" })],
  ["player", (data) => data.players.push({ id: "player" })],
  ["media", (data) => data.mediaAssets.push({ id: "media" })],
  ["proof", (data) => data.proofs.push({ id: "proof" })],
  ["foreign tenant-scoped row", (data) => {
    data.tableRows.CorrectionsProfile.push("another-organisation-id");
  }],
  ["unapproved record under synthetic tenant", (data) => {
    data.tables.push({ tableName: "FutureTenantRecord", hasOrganisationId: true });
    data.tableRows.FutureTenantRecord = [orgId];
  }],
  ["unapproved non-tenant record", (data) => { data.tableRows.UnusedGlobal = [null]; }],
  ["incomplete table catalog", (data) => { data.tables = [{ tableName: "Location", hasOrganisationId: true }]; }],
  ["unsafe table identifier", (data) => { data.tables.push({ tableName: 'Bad"Table', hasOrganisationId: true }); }]
]) {
  test(`preflight rejects ${label} without exposing row contents`, async () => {
    const data = syntheticData();
    change(data);
    await assert.rejects(assertInsideDemoSyntheticDatabase(database(data)), (error) => {
      assert.match(error.message, /^Inside demo synthetic-only preflight refused existing /);
      assert.doesNotMatch(error.message, /Customer|customer@example|another-organisation-id|Bad"Table/);
      if (label === "unapproved record under synthetic tenant") {
        assert.match(error.message, /table FutureTenantRecord/);
      }
      return true;
    });
  });
}
