import { insideDemoFacilities } from "../lib/inside-demo-scenario.mjs";
import { PUBLIC_PLAN_CATALOGUE, publicPlanDatabaseData } from "../lib/product-plan-catalogue.mjs";

const DEMO_ORGANISATION = { slug: "inside-synthetic-demo", name: "Synthetic Inside Demo Authority" };
// These fixed rows are inserted by the Health/Faith and Organisations migrations.
// A matching slug alone is insufficient: those migrations use ON CONFLICT DO NOTHING.
const MIGRATION_QA_ORGANISATIONS = [
  { id: "qa-health-organisation", slug: "ruvanas-health-qa", name: "Ruvanas Health QA",
    subscriptionId: "qa-health-subscription", planCode: "HEALTH_PRO" },
  { id: "qa-faith-organisation", slug: "ruvanas-faith-qa", name: "Ruvanas Faith QA",
    subscriptionId: "qa-faith-subscription", planCode: "FAITH_PRO" },
  { id: "qa-organisations-organisation", slug: "ruvanas-organisations-qa", name: "Ruvanas Organisations QA",
    subscriptionId: "qa-organisations-subscription", planCode: "ORGANISATIONS_PRO" }
];
const QA_ORGANISATION_BY_SLUG = new Map(MIGRATION_QA_ORGANISATIONS.map((row) => [row.slug, row]));
const QA_ORGANISATION_BY_ID = new Map(MIGRATION_QA_ORGANISATIONS.map((row) => [row.id, row]));
const QA_SUBSCRIPTION_NULL_FIELDS = [
  "retailRadioEnabled", "schoolRadioEnabled", "onlineRadioEnabled", "healthRadioEnabled",
  "faithRadioEnabled", "organisationsEnabled", "correctionsRadioEnabled",
  "schoolPublicPublishingEnabled", "retailMediaEnabled", "digitalSignageEnabled",
  "complimentaryAccessCodeId", "complimentaryAccessActivatedAt",
  "complimentaryPlanName", "complimentaryPlanCode", "complimentaryPlanTierNumber",
  "complimentaryPlanProductFamily", "complimentaryStudioExternalDestinationLimit",
  "complimentaryStationLimit", "complimentaryStorageLimitGb", "complimentaryListenerLimit",
  "complimentaryMaxBitrateKbps", "complimentaryIncludesCatalogue",
  "complimentaryLicensedMusicCatalogueLevel", "complimentaryPromoUploadEnabled",
  "complimentaryRetailRadioEnabled", "complimentarySchoolRadioEnabled",
  "complimentaryOnlineRadioEnabled", "complimentaryHealthRadioEnabled",
  "complimentaryFaithRadioEnabled", "complimentaryOrganisationsEnabled",
  "complimentaryCorrectionsRadioEnabled", "complimentarySchoolPublicPublishingEnabled",
  "complimentaryRetailMediaEnabled", "complimentaryDigitalSignageEnabled"
];
const DEMO_OWNER = { email: "inside-demo-owner@example.invalid", name: "Inside Demo Owner" };
const DEMO_DRAFT = "Synthetic orientation programme";
const DEMO_DRAFT_DESCRIPTION = "Fictional draft for exploring the review workflow. It contains no audio and cannot be broadcast.";
const DEMO_ZONE_SLUG = "wing-one";
const ALLOWED_POPULATED_TABLES = new Set([
  "_prisma_migrations", "Plan", "Organisation", "User", "OrganisationMember",
  "Subscription", "OrganisationMediaProfile", "Location", "Zone", "CorrectionsProfile",
  "CorrectionsFacility", "CorrectionsProgramme", "Session", "AuditLog"
]);
const ALLOWED_TENANT_TABLES = new Set([
  "AuditLog", "CorrectionsProfile", "CorrectionsProgramme", "Location",
  "OrganisationMember", "OrganisationMediaProfile", "Subscription"
]);
const REQUIRED_TENANT_TABLES = new Set([
  "AuditLog", "CorrectionsProfile", "CorrectionsProgramme", "Location",
  "MediaAsset", "OrganisationMember", "OrganisationMediaProfile", "Player", "ProofOfPlayEvent", "Subscription"
]);
const TABLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function refuse(category) {
  // Do not include database values, identities, credentials, or row contents.
  throw new Error(`Inside demo synthetic-only preflight refused existing ${category}.`);
}

function assertCount(value, category) {
  if (!Number.isSafeInteger(value) || value < 0) refuse(`${category} count`);
  return value;
}

function hasMigrationTrialWindow(subscription) {
  if (!(subscription.createdAt instanceof Date) || !(subscription.currentPeriodEnd instanceof Date) ||
    !Number.isFinite(subscription.createdAt.getTime()) ||
    !Number.isFinite(subscription.currentPeriodEnd.getTime())) return false;
  const expectedEnd = new Date(subscription.createdAt);
  expectedEnd.setUTCFullYear(expectedEnd.getUTCFullYear() + 10);
  // PostgreSQL's year interval can differ by one day for a leap-day start.
  return Math.abs(subscription.currentPeriodEnd.getTime() - expectedEnd.getTime()) <= 86_400_000;
}

async function assertOnlyExpectedIdentity(database) {
  const organisationCount = assertCount(await database.organisation.count(), "organisation");
  if (organisationCount > MIGRATION_QA_ORGANISATIONS.length + 1) refuse("organisation identity");
  const organisations = await database.organisation.findMany({
    select: { id: true, slug: true, name: true }, take: MIGRATION_QA_ORGANISATIONS.length + 2
  });
  if (organisations.length !== organisationCount) refuse("organisation identity");
  const seenSlugs = new Set();
  for (const row of organisations) {
    const expected = QA_ORGANISATION_BY_SLUG.get(row.slug);
    if (seenSlugs.has(row.slug) || (row.slug === DEMO_ORGANISATION.slug
      ? row.name !== DEMO_ORGANISATION.name
      : !expected || row.id !== expected.id || row.name !== expected.name)) {
      refuse("organisation identity");
    }
    seenSlugs.add(row.slug);
  }
  const organisation = organisations.find((row) => row.slug === DEMO_ORGANISATION.slug);

  if (assertCount(await database.user.count({ where: { email: { not: DEMO_OWNER.email } } }), "user") !== 0) {
    refuse("user identity");
  }
  const owner = await database.user.findUnique({
    where: { email: DEMO_OWNER.email }, select: { id: true, name: true, role: true }
  });
  if (owner && (owner.name !== DEMO_OWNER.name || owner.role !== "OWNER")) refuse("user identity");

  const facilityBySlug = new Map(insideDemoFacilities.map((facility) => [facility.slug, facility]));
  const locationCount = assertCount(await database.location.count(), "location");
  if (locationCount > facilityBySlug.size) refuse("facility identity");
  const locations = await database.location.findMany({
    select: { id: true, organisationId: true, slug: true, name: true,
      brandId: true, status: true, timezone: true, countryCode: true,
      addressLine1: true, addressLine2: true, city: true, region: true, postalCode: true },
    take: facilityBySlug.size + 1
  });
  if (locations.length !== locationCount) refuse("facility identity");
  const locationById = new Map();
  for (const location of locations) {
    const expected = facilityBySlug.get(location.slug);
    if (!organisation || !expected || location.organisationId !== organisation.id || location.name !== expected.name ||
      location.brandId !== null || location.status !== "ACTIVE" ||
      location.timezone !== "Europe/Malta" || location.countryCode !== "MT" ||
      location.addressLine1 !== null || location.addressLine2 !== null ||
      location.city !== null || location.region !== null || location.postalCode !== null) {
      refuse("facility identity");
    }
    locationById.set(location.id, expected);
  }

  const zoneCount = assertCount(await database.zone.count(), "zone");
  if (zoneCount > facilityBySlug.size) refuse("zone identity");
  const zones = await database.zone.findMany({
    select: { locationId: true, slug: true, name: true, status: true }, take: facilityBySlug.size + 1
  });
  if (zones.length !== zoneCount) refuse("zone identity");
  for (const zone of zones) {
    const expected = locationById.get(zone.locationId);
    if (!expected || zone.slug !== DEMO_ZONE_SLUG || zone.name !== expected.zone || zone.status !== "ACTIVE") {
      refuse("zone identity");
    }
  }

  const facilityCount = assertCount(await database.correctionsFacility.count(), "Corrections facility");
  if (facilityCount > facilityBySlug.size) refuse("Corrections facility identity");
  const correctionsFacilities = await database.correctionsFacility.findMany({
    select: { locationId: true, youthFacility: true, dualApprovalRequired: true,
      policyVersion: true, allowedGenres: true, restrictedGenres: true,
      blockedTrackIds: true, blockedArtists: true, requestAvailability: true,
      publicRequestCode: true, songRequestsEnabled: true, messageRequestsEnabled: true,
      dedicationsEnabled: true, announcementApprovalMode: true, priorityEnabled: true,
      emergencyEnabled: true, emergencyDualControl: true, emergencyDrillsEnabled: true },
    take: facilityBySlug.size + 1
  });
  if (correctionsFacilities.length !== facilityCount || correctionsFacilities.some((facility) =>
    !locationById.has(facility.locationId) || facility.youthFacility !== false ||
    facility.dualApprovalRequired !== false || facility.policyVersion !== 1 ||
    !Array.isArray(facility.allowedGenres) || facility.allowedGenres.length !== 0 ||
    !Array.isArray(facility.restrictedGenres) || facility.restrictedGenres.length !== 0 ||
    !Array.isArray(facility.blockedTrackIds) || facility.blockedTrackIds.length !== 0 ||
    !Array.isArray(facility.blockedArtists) || facility.blockedArtists.length !== 0 ||
    facility.requestAvailability !== "DISABLED" || facility.publicRequestCode !== null ||
    facility.songRequestsEnabled !== false || facility.messageRequestsEnabled !== false ||
    facility.dedicationsEnabled !== false || facility.announcementApprovalMode !== "EXPLICIT" ||
    facility.priorityEnabled !== false || facility.emergencyEnabled !== false ||
    facility.emergencyDualControl !== false || facility.emergencyDrillsEnabled !== false)) {
    refuse("Corrections facility identity");
  }

  const programmeCount = assertCount(await database.correctionsProgramme.count(), "programme");
  if (programmeCount > 1) refuse("programme identity");
  const programmes = await database.correctionsProgramme.findMany({
    select: { organisationId: true, facilityId: true, title: true, description: true, status: true }, take: 2
  });
  if (programmes.length !== programmeCount) refuse("programme identity");
  for (const programme of programmes) {
    const expected = locationById.get(programme.facilityId);
    if (!organisation || programme.organisationId !== organisation.id || !expected ||
      !expected.draft || programme.title !== DEMO_DRAFT ||
      programme.description !== DEMO_DRAFT_DESCRIPTION || programme.status !== "DRAFT") {
      refuse("programme identity");
    }
  }
  return { organisationId: organisation?.id ?? null, ownerId: owner?.id ?? null };
}

async function assertNoOperationalRecords(database) {
  for (const [delegate, category] of [
    [database.player, "player"], [database.mediaAsset, "media"],
    [database.proofOfPlayEvent, "playback proof"]
  ]) {
    if (assertCount(await delegate.count(), category) !== 0) refuse(`${category} records`);
  }
}

async function assertSeedRelationships(database, { organisationId, ownerId }) {
  const expectedPlans = new Map(PUBLIC_PLAN_CATALOGUE.map((plan) => [plan.code, publicPlanDatabaseData(plan)]));
  const planFields = Object.keys(expectedPlans.values().next().value);
  const planCount = assertCount(await database.plan.count(), "plan");
  if (planCount > expectedPlans.size) refuse("plan catalogue");
  const plans = await database.plan.findMany({
    select: { id: true, studioExternalDestinationLimit: true,
      ...Object.fromEntries(planFields.map((field) => [field, true])) },
    take: expectedPlans.size + 1
  });
  if (plans.length !== planCount || plans.some((plan) => {
    const expected = expectedPlans.get(plan.code);
    return !expected || plan.studioExternalDestinationLimit !== null ||
      planFields.some((field) => plan[field] !== expected[field]);
  })) refuse("plan catalogue");
  const planCodeById = new Map(plans.map((plan) => [plan.id, plan.code]));

  const membershipCount = assertCount(await database.organisationMember.count(), "membership");
  if (membershipCount > 1) refuse("membership scope");
  const memberships = await database.organisationMember.findMany({
    select: { organisationId: true, userId: true, role: true }, take: 2
  });
  if (memberships.length !== membershipCount || memberships.some((membership) =>
    !organisationId || !ownerId || membership.organisationId !== organisationId ||
    membership.userId !== ownerId || membership.role !== "OWNER")) refuse("membership scope");

  const subscriptionCount = assertCount(await database.subscription.count(), "subscription");
  if (subscriptionCount > MIGRATION_QA_ORGANISATIONS.length + 1) refuse("subscription scope");
  const subscriptions = await database.subscription.findMany({
    select: { id: true, organisationId: true, planId: true, status: true,
      createdAt: true, currentPeriodEnd: true, complimentaryAccessActive: true,
      ...Object.fromEntries(QA_SUBSCRIPTION_NULL_FIELDS.map((field) => [field, true])) },
    take: MIGRATION_QA_ORGANISATIONS.length + 2
  });
  if (subscriptions.length !== subscriptionCount) refuse("subscription scope");
  const seenSubscriptionOrganisations = new Set();
  for (const subscription of subscriptions) {
    const expected = QA_ORGANISATION_BY_ID.get(subscription.organisationId);
    if (seenSubscriptionOrganisations.has(subscription.organisationId) ||
      (subscription.organisationId === organisationId && organisationId
        ? planCodeById.get(subscription.planId) !== "CORRECTIONS_NETWORK" || subscription.status !== "ACTIVE"
        : !expected || subscription.id !== expected.subscriptionId ||
          planCodeById.get(subscription.planId) !== expected.planCode || subscription.status !== "TRIAL" ||
          subscription.complimentaryAccessActive !== false ||
          QA_SUBSCRIPTION_NULL_FIELDS.some((field) => subscription[field] !== null) ||
          !hasMigrationTrialWindow(subscription))) {
      refuse("subscription scope");
    }
    seenSubscriptionOrganisations.add(subscription.organisationId);
  }

  const mediaProfileCount = assertCount(await database.organisationMediaProfile.count(), "organisations media profile");
  if (mediaProfileCount > 1) refuse("organisations media profile scope");
  const mediaProfiles = await database.organisationMediaProfile.findMany({
    select: { id: true, organisationId: true, template: true, locale: true,
      timezone: true, regionalPriceBookCurrency: true, terminology: true, disclosureText: true },
    take: 2
  });
  if (mediaProfiles.length !== mediaProfileCount || mediaProfiles.some((profile) =>
    profile.id !== "qa-organisations-media-profile" ||
    profile.organisationId !== "qa-organisations-organisation" ||
    profile.template !== "GENERAL" || profile.locale !== "en-MT" ||
    profile.timezone !== "Europe/Malta" || profile.regionalPriceBookCurrency !== "EUR" ||
    profile.terminology !== null || profile.disclosureText !== null)) {
    refuse("organisations media profile scope");
  }

  const profileCount = assertCount(await database.correctionsProfile.count(), "Corrections profile");
  if (profileCount > 1) refuse("Corrections profile scope");
  const profiles = await database.correctionsProfile.findMany({
    select: { organisationId: true, cleanOnly: true, policyVersion: true, allowedGenres: true,
      restrictedGenres: true, blockedTrackIds: true, blockedArtists: true }, take: 2
  });
  if (profiles.length !== profileCount || profiles.some((profile) =>
    !organisationId || profile.organisationId !== organisationId || !profile.cleanOnly ||
    profile.policyVersion !== 1 ||
    profile.allowedGenres.length !== 0 || profile.restrictedGenres.length !== 0 ||
    profile.blockedTrackIds.length !== 0 || profile.blockedArtists.length !== 0)) {
    refuse("Corrections profile scope");
  }
}

async function assertSyntheticSessionAndAudit(database, { organisationId, ownerId }) {
  const syntheticOrganisationId = organisationId ?? "__no_demo_organisation__";
  const syntheticOwnerId = ownerId ?? "__no_demo_owner__";
  if (assertCount(await database.session.count(), "session") > 100) refuse("session volume");
  if (assertCount(await database.session.count({ where: { userId: { not: syntheticOwnerId } } }), "session") !== 0 ||
    assertCount(await database.session.count({ where: {
      activeOrganisationId: { not: null }, NOT: { activeOrganisationId: syntheticOrganisationId }
    } }), "session") !== 0) refuse("session identity");

  if (assertCount(await database.auditLog.count(), "audit") > 1_000) refuse("audit volume");
  if (assertCount(await database.auditLog.count({ where: {
    organisationId: { not: null }, NOT: { organisationId: syntheticOrganisationId }
  } }), "audit") !== 0 ||
    assertCount(await database.auditLog.count({ where: {
      actorUserId: { not: null }, NOT: { actorUserId: syntheticOwnerId }
    } }), "audit") !== 0 ||
    assertCount(await database.auditLog.count({ where: { OR: [
      { schoolNetworkId: { not: null } }, { stationNetworkId: { not: null } },
      { actorServiceAccountId: { not: null } }
    ] } }), "audit") !== 0) refuse("audit scope");
}

async function assertNoOtherDatabaseRows(database, organisationId) {
  const tables = await database.$queryRaw`
    SELECT t.table_name AS "tableName",
      EXISTS (
        SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
          AND c.column_name = 'organisationId'
      ) AS "hasOrganisationId"
    FROM information_schema.tables AS t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  `;
  if (!Array.isArray(tables) || tables.length === 0) refuse("database table inventory");
  const seen = new Set();
  for (const row of tables) {
    const tableName = row?.tableName;
    if (typeof tableName !== "string" || !TABLE_IDENTIFIER.test(tableName) || seen.has(tableName) ||
      typeof row?.hasOrganisationId !== "boolean" ||
      (row.hasOrganisationId && ALLOWED_POPULATED_TABLES.has(tableName) && !ALLOWED_TENANT_TABLES.has(tableName))) {
      refuse("database table inventory");
    }
    seen.add(tableName);
  }
  for (const required of ALLOWED_POPULATED_TABLES) if (!seen.has(required)) refuse("database table inventory");
  for (const required of REQUIRED_TENANT_TABLES) {
    if (!tables.some((row) => row.tableName === required && row.hasOrganisationId)) refuse("database table inventory");
  }

  for (const { tableName, hasOrganisationId } of tables) {
    // Identifiers come only from the verified database catalog, not request input.
    // Every unlisted public table must be empty. Tenant rows are restricted
    // to the demo organisation, except the migration QA rows checked above.
    const allowedTenantTable = ALLOWED_TENANT_TABLES.has(tableName) && hasOrganisationId;
    // Only the two migration-owned tables may contain the three QA tenants.
    // All other operational tenant tables remain scoped to the demo authority.
    const allowedOrganisationIds = [organisationId ?? "__no_demo_organisation__",
      ...(tableName === "Subscription" || tableName === "OrganisationMediaProfile"
        ? MIGRATION_QA_ORGANISATIONS.map((row) => row.id) : [])];
    const rows = allowedTenantTable
      ? await database.$queryRawUnsafe(
        `SELECT EXISTS (SELECT 1 FROM "public"."${tableName}" WHERE "organisationId" IS NOT NULL AND "organisationId" NOT IN (${allowedOrganisationIds.map((_, index) => `$${index + 1}`).join(", ")})) AS "hasUnexpected"`,
        ...allowedOrganisationIds
      )
      : ALLOWED_POPULATED_TABLES.has(tableName) ? [{ hasUnexpected: false }] : await database.$queryRawUnsafe(
        `SELECT EXISTS (SELECT 1 FROM "public"."${tableName}") AS "hasUnexpected"`
      );
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.hasUnexpected !== "boolean") {
      refuse("database table inventory");
    }
    if (rows[0].hasUnexpected) refuse(`non-synthetic database records in table ${tableName}`);
  }
}

// Run inside the seed transaction, before its first write. This is a bounded
// safety barrier, not a substitute for an independent content/storage audit.
export async function assertInsideDemoSyntheticDatabase(database) {
  const identities = await assertOnlyExpectedIdentity(database);
  await assertNoOperationalRecords(database);
  await assertSeedRelationships(database, identities);
  await assertSyntheticSessionAndAudit(database, identities);
  await assertNoOtherDatabaseRows(database, identities.organisationId);
}
