import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  resetSubscriberTestData,
  subscriberTestResetPreview,
  SUBSCRIBER_TEST_RESET_CONFIRMATION,
  validateSubscriberTestReset
} from "../lib/subscriber-test-reset.mjs";

const retainedUser = { id: "super-1", email: "manuelchircop@gmail.com", name: "Manuel", role: "SUPER_ADMIN" };

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
    billingContract: { count: async () => 0 }
  };
  assert.deepEqual(await subscriberTestResetPreview(database, { actor: retainedUser, retainedEmail: retainedUser.email }), {
    retainedUser,
    usersToDelete: 7,
    superAdminsToDelete: 1,
    organisationsToDelete: 6,
    codesToDelete: 4,
    externalBillingRecords: 0
  });
});

test("reset removes tenant records atomically before non-retained users", async () => {
  const calls = [];
  const deleting = (name, count = 1) => ({ deleteMany: async () => { calls.push(name); return { count }; } });
  const tx = {
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
    supportTicket: deleting("supportTickets"), betaProgramme: deleting("betaProgrammes"), complimentaryAccessCode: deleting("accessCodes"),
    billingInvoice: { count: async () => 0 }, billingContract: { count: async () => 0 },
    recoveryControl: { updateMany: async () => ({ count: 0 }) }, recoveryEvidence: { updateMany: async () => ({ count: 0 }) }
  };
  const database = { $transaction: async (callback) => callback(tx) };
  const result = await resetSubscriberTestData(database, { actor: retainedUser, retainedEmail: retainedUser.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION });
  assert.equal(result.deletedUsers, 1);
  assert.equal(result.deletedOrganisations, 1);
  assert.ok(calls.indexOf("organisations") < calls.indexOf("users"));
  assert.equal(calls.at(-1), "resetAudit");
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

test("reset endpoint and interface keep the operation Super Admin-only and explicit", async () => {
  const [route, page, client, navigation] = await Promise.all([
    readFile(new URL("../app/api/admin/test-data-reset/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/test-data-reset/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/test-data-reset/TestDataReset.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8")
  ]);
  assert.match(route, /access\.user\.role !== "SUPER_ADMIN"/);
  assert.match(route, /SELF_SERVICE_REGISTRATION_ENABLED/);
  assert.match(route, /resetSubscriberTestData/);
  assert.match(page, /user\?\.role !== "SUPER_ADMIN"/);
  assert.match(client, /DELETE TEST SUBSCRIBERS/);
  assert.match(client, /Permanent action/);
  assert.match(navigation, /\/admin\/test-data-reset/);
});
