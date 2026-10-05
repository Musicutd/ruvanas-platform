import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { subscriberTestResetAvailable } from "../lib/subscriber-test-reset-availability.mjs";
import { buildAdminNavigation } from "../lib/user-experience-navigation.mjs";
import {
  resetSubscriberTestData,
  subscriberTestResetPreview,
  ORGANISATION_SCOPED_RESET_MODELS,
  SUBSCRIBER_TEST_RESET_CONFIRMATION,
  validateSubscriberTestReset
} from "../lib/subscriber-test-reset.mjs";

const retainedUser = { id: "super-1", email: "manuelchircop@gmail.com", name: "Manuel", role: "SUPER_ADMIN" };

const localResetEnvironment = {
  SUBSCRIBER_TEST_RESET_ENABLED: "1",
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://test:test@localhost:5432/fictional_test_data"
};

test("subscriber reset is available only with explicit opt-in against a loopback development database", () => {
  assert.equal(subscriberTestResetAvailable(localResetEnvironment), true);
  for (const host of ["127.0.0.1", "[::1]"]) {
    assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, DATABASE_URL: `postgres://test:test@${host}:5432/fictional_test_data` }), true);
  }
  assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, SUBSCRIBER_TEST_RESET_ENABLED: undefined }), false);
  assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, SUBSCRIBER_TEST_RESET_ENABLED: "true" }), false);
  assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, NODE_ENV: "production" }), false);
  assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, NODE_ENV: "test" }), false);
  assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, DATABASE_URL: "postgresql://test:test@database.internal:5432/ruvanas" }), false);
  assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, DATABASE_URL: "postgresql://test:test@localhost.example:5432/ruvanas" }), false);
  assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, DATABASE_URL: "https://localhost:5432/ruvanas" }), false);
  assert.equal(subscriberTestResetAvailable({ ...localResetEnvironment, DATABASE_URL: "not a database URL" }), false);
});

test("subscriber reset navigation appears only for an opted-in local Super Admin", () => {
  const hrefs = (role, environment) => buildAdminNavigation(role, environment)
    .flatMap((section) => section.items.map((item) => item.href));
  assert.equal(hrefs("SUPER_ADMIN", localResetEnvironment).includes("/admin/test-data-reset"), true);
  assert.equal(hrefs("SUPER_ADMIN", { ...localResetEnvironment, NODE_ENV: "production" }).includes("/admin/test-data-reset"), false);
  assert.equal(hrefs("SUPPORT", localResetEnvironment).includes("/admin/test-data-reset"), false);
});

test("subscriber reset can only retain the signed-in Super Admin with exact confirmation", () => {
  assert.equal(validateSubscriberTestReset({ actor: retainedUser, retainedEmail: " ManuelChircop@gmail.com ", confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION }), retainedUser.email);
  assert.throws(() => validateSubscriberTestReset({ actor: { ...retainedUser, role: "SUPPORT" }, retainedEmail: retainedUser.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION }), /Super Admin/);
  assert.throws(() => validateSubscriberTestReset({ actor: retainedUser, retainedEmail: "someone@example.com", confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION }), /signed-in Super Admin/);
  assert.throws(() => validateSubscriberTestReset({ actor: retainedUser, retainedEmail: retainedUser.email, confirmation: "delete" }), /exactly/);
});

test("preview reports bounded counts without exposing subscriber identities", async () => {
  const database = {
    user: { findUnique: async () => retainedUser, count: async ({ where }) => where.role ? 1 : 7 },
    organisation: { findMany: async () => Array.from({ length: 6 }, (_, index) => ({ id: `org-${index}` })) },
    complimentaryAccessCode: { count: async () => 4 },
    billingInvoice: { count: async () => 0 },
    billingContract: { count: async () => 0 },
    rightsUsageLedgerEvent: { count: async () => 3 },
    rightsReportAttestation: { count: async () => 2 }
  };
  assert.deepEqual(await subscriberTestResetPreview(database, { actor: retainedUser, retainedEmail: retainedUser.email }), {
    retainedUser,
    usersToDelete: 7,
    superAdminsToDelete: 1,
    organisationsToDelete: 6,
    codesToDelete: 4,
    externalBillingRecords: 0,
    rightsEvidenceToArchive: 5
  });
});

test("reset removes tenant records atomically before non-retained users", async () => {
  const calls = [];
  const deletionArgs = new Map();
  const deleting = (name, count = 1) => ({ deleteMany: async () => { calls.push(name); return { count }; } });
  const tx = new Proxy({
    user: {
      findUnique: async () => retainedUser,
      findMany: async () => [{ id: "user-2" }],
      deleteMany: async () => { calls.push("users"); return { count: 1 }; }
    },
    organisation: { findMany: async () => [{ id: "org-1" }], deleteMany: async () => { calls.push("organisations"); return { count: 1 }; } },
    schoolNetwork: { findMany: async () => [{ id: "school-network-1" }], ...deleting("schoolNetworks") },
    stationNetwork: { findMany: async () => [{ id: "station-network-1" }], ...deleting("stationNetworks") },
    auditLog: { ...deleting("auditLogs"), create: async () => { calls.push("resetAudit"); return { id: "audit-1" }; } }, rightsReportAttestation: deleting("rightsAttestations"), auditExportSeal: deleting("auditExportSeals"),
    rightsUsageLedgerEvent: deleting("rightsLedger"), radioSyndicationAgreement: deleting("syndicationAgreements"),
    radioSyndicationOffer: deleting("syndicationOffers"), stationNetworkAgreement: deleting("stationNetworkAgreements"),
    studioBroadcastCommand: deleting("studioBroadcastCommands"), studioBroadcastSession: deleting("studioBroadcastSessions"),
    studioBroadcastDestination: deleting("studioBroadcastDestinations"), studioPlayoutSession: deleting("studioPlayoutSessions"),
    studioProgrammePack: deleting("studioProgrammePacks"), betaProgrammeReview: deleting("betaProgrammeReviews"),
    supportTicket: deleting("supportTickets"), betaProgramme: deleting("betaProgrammes"), complimentaryAccessCode: deleting("accessCodes"),
    digitalSignageDeliveryProof: { deleteMany: async (args) => { calls.push("digitalSignageDeliveryProof"); deletionArgs.set("deliveryProofs", args); return { count: 1 }; } },
    digitalSignagePlaylistItem: { deleteMany: async (args) => { calls.push("digitalSignagePlaylistItem"); deletionArgs.set("playlistItems", args); return { count: 1 }; } },
    retailMediaOrderVisualCreative: { deleteMany: async (args) => { calls.push("retailMediaOrderVisualCreative"); deletionArgs.set("retailVisualCreatives", args); return { count: 1 }; } },
    schoolEpisodeExchangeOffer: { deleteMany: async (args) => { calls.push("schoolEpisodeExchangeOffer"); deletionArgs.set("exchangeOffers", args); return { count: 1 }; } },
    retailMediaOrderCreative: { deleteMany: async (args) => { calls.push("retailMediaOrderCreative"); deletionArgs.set("retailMediaCreatives", args); return { count: 1 }; } },
    radioClockItem: { deleteMany: async (args) => { calls.push("radioClockItem"); deletionArgs.set("radioClockItems", args); return { count: 1 }; } },
    schoolRundownItem: { deleteMany: async (args) => { calls.push("schoolRundownItem"); deletionArgs.set("schoolRundownItems", args); return { count: 1 }; } },
    schoolEpisodeContributor: { deleteMany: async (args) => { calls.push("schoolEpisodeContributor"); deletionArgs.set("schoolEpisodeContributors", args); return { count: 1 }; } },
    billingInvoice: { count: async () => 0, ...deleting("billingInvoice", 0) }, billingContract: { count: async () => 0 },
    recoveryControl: { updateMany: async () => ({ count: 0 }) }, recoveryEvidence: { updateMany: async () => ({ count: 0 }) },
    $executeRaw: async () => { calls.push("rightsArchive"); return 1; }
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return deleting(String(property), 0);
    }
  });
  let transactionOptions;
  const database = { $transaction: async (callback, options) => { transactionOptions = options; return callback(tx); } };
  const result = await resetSubscriberTestData(database, { actor: retainedUser, retainedEmail: retainedUser.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION });
  assert.equal(result.deletedUsers, 1);
  assert.equal(result.deletedOrganisations, 1);
  assert.deepEqual(transactionOptions, { maxWait: 10_000, timeout: 300_000 });
  assert.equal(result.archivedRightsEvidence, 2);
  assert.ok(calls.indexOf("rightsArchive") < calls.indexOf("rightsAttestations"));
  assert.ok(calls.indexOf("rightsArchive") < calls.indexOf("rightsLedger"));
  assert.ok(calls.indexOf("studioBroadcastCommands") < calls.indexOf("organisations"));
  assert.ok(calls.indexOf("betaProgrammeReviews") < calls.indexOf("users"));
  assert.ok(calls.indexOf("digitalSignageDeliveryProof") < calls.indexOf("digitalSignagePlaylistItem"));
  assert.ok(calls.indexOf("digitalSignagePlaylistItem") < calls.indexOf("digitalSignageAsset"));
  assert.ok(calls.indexOf("retailMediaOrderVisualCreative") < calls.indexOf("digitalSignageAsset"));
  assert.ok(calls.indexOf("schoolEpisodeExchangeOffer") < calls.indexOf("promoAsset"));
  assert.ok(calls.indexOf("retailMediaOrderCreative") < calls.indexOf("promoAsset"));
  assert.ok(calls.indexOf("radioClockItem") < calls.indexOf("promoAsset"));
  assert.ok(calls.indexOf("schoolRundownItem") < calls.indexOf("promoAsset"));
  assert.ok(calls.indexOf("promoAsset") < calls.indexOf("mediaAsset"));
  assert.ok(calls.indexOf("audioProject") < calls.indexOf("mediaAsset"));
  assert.ok(calls.indexOf("schoolEpisodeContributor") < calls.indexOf("studentContributor"));
  assert.deepEqual(deletionArgs.get("deliveryProofs"), {
    where: { organisationId: { in: ["org-1"] } }
  });
  assert.deepEqual(deletionArgs.get("playlistItems"), {
    where: { playlist: { organisationId: { in: ["org-1"] } } }
  });
  assert.deepEqual(deletionArgs.get("retailVisualCreatives"), {
    where: {
      OR: [
        { order: { organisationId: { in: ["org-1"] } } },
        { signageAsset: { organisationId: { in: ["org-1"] } } }
      ]
    }
  });
  assert.deepEqual(deletionArgs.get("exchangeOffers"), {
    where: {
      OR: [
        { sourceOrganisationId: { in: ["org-1"] } },
        { approvedPromoVersion: { promoAsset: { organisationId: { in: ["org-1"] } } } }
      ]
    }
  });
  assert.deepEqual(deletionArgs.get("retailMediaCreatives"), {
    where: {
      OR: [
        { order: { organisationId: { in: ["org-1"] } } },
        { promoVersion: { promoAsset: { organisationId: { in: ["org-1"] } } } }
      ]
    }
  });
  assert.deepEqual(deletionArgs.get("radioClockItems"), {
    where: {
      OR: [
        { radioClock: { organisationId: { in: ["org-1"] } } },
        { promoVersion: { promoAsset: { organisationId: { in: ["org-1"] } } } }
      ]
    }
  });
  assert.deepEqual(deletionArgs.get("schoolRundownItems"), {
    where: {
      OR: [
        { rundown: { organisationId: { in: ["org-1"] } } },
        { sourcePromoVersion: { promoAsset: { organisationId: { in: ["org-1"] } } } }
      ]
    }
  });
  assert.deepEqual(deletionArgs.get("schoolEpisodeContributors"), {
    where: {
      OR: [
        { episode: { organisationId: { in: ["org-1"] } } },
        { contributor: { organisationId: { in: ["org-1"] } } }
      ]
    }
  });
  assert.ok(calls.indexOf("digitalSignageDeliveryProof") < calls.indexOf("digitalSignagePlaylist"));
  assert.ok(calls.indexOf("digitalSignagePlaylist") < calls.indexOf("digitalSignageLayout"));
  assert.ok(calls.indexOf("voiceTrackSegue") < calls.indexOf("audioProject"));
  assert.ok(calls.indexOf("organisations") < calls.indexOf("users"));
  assert.equal(calls.at(-1), "resetAudit");
});

test("organisation reset order covers every tenant model and places children before parents", () => {
  const names = ORGANISATION_SCOPED_RESET_MODELS.map(({ modelName }) => modelName);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length > 100);
  assert.ok(names.indexOf("DigitalSignageDeliveryProof") < names.indexOf("DigitalSignagePlaylist"));
  assert.ok(names.indexOf("DigitalSignagePlaylist") < names.indexOf("DigitalSignageLayout"));
  assert.ok(names.indexOf("VoiceTrackSegue") < names.indexOf("AudioProject"));
  assert.ok(names.indexOf("StudioProductHandoff") < names.indexOf("AudioRender"));
  assert.ok(names.indexOf("PromoAsset") < names.indexOf("MediaAsset"));
  assert.ok(names.indexOf("AudioProject") < names.indexOf("MediaAsset"));
  for (const promoVersionConsumer of [
    "Campaign",
    "VoiceTrackSegue",
    "SchoolAnnouncement",
    "SchoolSubmission",
    "StudioProductHandoff",
    "LiveStudioSession",
    "PlayoutIntent",
    "ProofOfPlayEvent"
  ]) {
    assert.ok(
      names.indexOf(promoVersionConsumer) < names.indexOf("PromoAsset"),
      `${promoVersionConsumer} must be cleared before PromoAsset`
    );
  }
});

test("reset stops before deletion when external billing evidence exists", async () => {
  let deletionAttempted = false;
  const tx = {
    user: { findUnique: async () => retainedUser, findMany: async () => [{ id: "user-2" }] },
    organisation: { findMany: async () => [{ id: "org-1" }] },
    schoolNetwork: { findMany: async () => [] },
    stationNetwork: { findMany: async () => [] },
    billingInvoice: { count: async () => 1 },
    billingContract: { count: async () => 0 },
    auditLog: { deleteMany: async () => { deletionAttempted = true; } }
  };
  await assert.rejects(
    resetSubscriberTestData({ $transaction: async (callback) => callback(tx) }, { actor: retainedUser, retainedEmail: retainedUser.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION }),
    /external billing records/
  );
  assert.equal(deletionAttempted, false);
});

test("rights evidence archive failures report the exact safe reset stage", async () => {
  const tx = new Proxy({
    user: { findUnique: async () => retainedUser, findMany: async () => [{ id: "user-2" }] },
    organisation: { findMany: async () => [{ id: "org-1" }] },
    schoolNetwork: { findMany: async () => [] },
    stationNetwork: { findMany: async () => [] },
    billingInvoice: { count: async () => 0 },
    billingContract: { count: async () => 0 },
    recoveryControl: { updateMany: async () => ({ count: 0 }) },
    recoveryEvidence: { updateMany: async () => ({ count: 0 }) },
    $executeRaw: async () => { throw new Error("archive unavailable"); }
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return { deleteMany: async () => ({ count: 0 }) };
    }
  });
  await assert.rejects(
    resetSubscriberTestData(
      { $transaction: async (callback) => callback(tx) },
      { actor: retainedUser, retainedEmail: retainedUser.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION }
    ),
    /Reference: RIGHTS_EVIDENCE_ARCHIVE/
  );
});

test("reset endpoint, interface, and migration keep the operation controlled and explicit", async () => {
  const [route, page, client, organisationsPage, navigation, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/admin/test-data-reset/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/test-data-reset/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/test-data-reset/TestDataReset.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/organisations/page.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261117000000_subscriber_reset_rights_evidence_archive/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(route, /access\.user\.role !== "SUPER_ADMIN"/);
  assert.match(route, /!subscriberTestResetAvailable\(\)/);
  assert.match(route, /SELF_SERVICE_REGISTRATION_ENABLED/);
  assert.match(route, /resetSubscriberTestData/);
  assert.match(page, /user\?\.role !== "SUPER_ADMIN" \|\| !subscriberTestResetAvailable\(\)/);
  assert.match(organisationsPage, /canManageEntitlements && subscriberTestResetAvailable\(\)/);
  assert.match(client, /DELETE TEST SUBSCRIBERS/);
  assert.match(client, /Permanent action/);
  assert.match(client, /rights-evidence records to archive/);
  assert.match(client, /immutable archive/);
  assert.match(navigation, /\/admin\/test-data-reset/);
  assert.match(navigation, /subscriberTestResetAvailable\(environment\)/);
  assert.match(schema, /model RightsEvidenceResetArchive/);
  assert.match(migration, /archive\."payload" = to_jsonb\(OLD\)/);
  assert.match(migration, /RightsEvidenceResetArchive_immutable/);
});
