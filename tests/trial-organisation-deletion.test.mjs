import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  assertTrialOrganisationDeletion,
  deleteTrialOrganisation,
  trialOrganisationConfirmation
} from "../lib/trial-organisation-deletion.mjs";

const actor = { id: "super-1", role: "SUPER_ADMIN" };
const organisation = { id: "org-1", name: "Trial Shop", slug: "trial-shop", subscription: { status: "TRIAL" }, _count: { members: 2 } };

test("trial organisation deletion requires a Super Admin, a trial account and exact slug confirmation", () => {
  assert.equal(trialOrganisationConfirmation("trial-shop"), "DELETE trial-shop");
  assert.equal(assertTrialOrganisationDeletion({ actor, organisation, confirmation: "DELETE trial-shop" }), "DELETE trial-shop");
  assert.throws(() => assertTrialOrganisationDeletion({ actor: { ...actor, role: "SUPPORT" }, organisation, confirmation: "DELETE trial-shop" }), /Super Admin/);
  assert.throws(() => assertTrialOrganisationDeletion({ actor, organisation: { ...organisation, subscription: { status: "ACTIVE" } }, confirmation: "DELETE trial-shop" }), /Only trial/);
  assert.throws(() => assertTrialOrganisationDeletion({ actor, organisation, confirmation: "trial-shop" }), /exactly/);
});

test("single trial deletion preserves users and records an audit tombstone", async () => {
  const calls = [];
  const tx = {
    $queryRaw: async (strings, id) => { calls.push(["lock", strings.join("?"), id]); return [{ id }]; },
    organisation: {
      findUnique: async () => { calls.push("load"); return organisation; },
      findFirst: async () => { calls.push("check Corrections"); return null; },
      delete: async () => { calls.push("organisation"); return organisation; }
    },
    billingInvoice: { count: async () => 0 },
    billingContract: { count: async () => 0 },
    studioPlayoutSession: { findFirst: async () => { calls.push("check Studio playout"); return null; } },
    studioProgrammePack: { findFirst: async () => { calls.push("check Studio pack"); return null; } },
    auditLog: { create: async ({ data }) => { calls.push(data.action); return { id: "audit-1" }; } }
  };
  let transactionOptions;
  const result = await deleteTrialOrganisation({ $transaction: async (callback, options) => {
    transactionOptions = options;
    return callback(tx);
  } }, {
    actor,
    organisationId: organisation.id,
    confirmation: "DELETE trial-shop"
  });
  assert.match(calls[0][1], /"Organisation".*FOR UPDATE/);
  assert.equal(calls[0][2], organisation.id);
  assert.match(calls[1][1], /"Subscription".*FOR UPDATE/);
  assert.equal(calls[1][2], organisation.id);
  assert.deepEqual(calls.slice(2), [
    "load", "check Corrections", "check Studio playout", "check Studio pack",
    "TRIAL_ORGANISATION_DELETED", "organisation"
  ]);
  assert.equal(transactionOptions.isolationLevel, "ReadCommitted");
  assert.equal(result.userAccountsDeleted, 0);
  assert.equal(result.memberLinksRemoved, 2);
});

test("single trial deletion blocks external billing evidence before deleting", async () => {
  let deleted = false;
  const tx = {
    $queryRaw: async () => [{ id: organisation.id }],
    organisation: { findUnique: async () => organisation, delete: async () => { deleted = true; } },
    billingInvoice: { count: async () => 1 },
    billingContract: { count: async () => 0 },
    auditLog: { create: async () => ({ id: "audit-1" }) }
  };
  await assert.rejects(
    deleteTrialOrganisation({ $transaction: async (callback) => callback(tx) }, { actor, organisationId: organisation.id, confirmation: "DELETE trial-shop" }),
    /external billing records/
  );
  assert.equal(deleted, false);
});

test("trial deletion blocks a Corrections plan or entitlement before writing", async () => {
  const subscriptions = [
    { status: "TRIAL", plan: { productFamily: "CORRECTIONS" } },
    { status: "TRIAL", plan: { correctionsRadioEnabled: true } },
    { status: "TRIAL", correctionsRadioEnabled: true },
    { status: "TRIAL", complimentaryPlanProductFamily: "CORRECTIONS" },
    { status: "TRIAL", complimentaryCorrectionsRadioEnabled: true }
  ];
  for (const subscription of subscriptions) {
    let wrote = false;
    const tx = {
      $queryRaw: async () => [{ id: organisation.id }],
      organisation: {
        findUnique: async () => ({ ...organisation, subscription }),
        findFirst: async () => { throw new Error("Entitlement should be blocked before an evidence query."); },
        delete: async () => { wrote = true; }
      },
      billingInvoice: { count: async () => 0 },
      billingContract: { count: async () => 0 },
      auditLog: { create: async () => { wrote = true; } }
    };
    await assert.rejects(
      deleteTrialOrganisation({ $transaction: async (callback) => callback(tx) },
        { actor, organisationId: organisation.id, confirmation: "DELETE trial-shop" }),
      (error) => error.code === "CORRECTIONS_EVIDENCE_PRESENT"
    );
    assert.equal(wrote, false);
  }
});

test("trial deletion checks every Corrections marker, playback proof and audit evidence", async () => {
  const directRelations = [
    "correctionsProgrammes", "correctionsFacilityGrants", "correctionsContributors",
    "correctionsStudioSessions", "correctionsRequests", "correctionsRehabCategories",
    "correctionsRehabContent", "correctionsDevelopmentModules", "correctionsAnnouncements",
    "correctionsOverrides", "correctionsNetworkGrants", "correctionsNetworkWindows",
    "correctionsDistributions", "correctionsNetworkAudioDistributions", "correctionsSyndicationOffers"
  ];
  const evidenceCases = [
    { correctionsProfile: { isNot: null } },
    { locations: { some: { correctionsFacility: { isNot: null } } } },
    { stations: { some: { productFamily: "CORRECTIONS" } } },
    { channels: { some: { musicRightsUse: "CORRECTIONS_RADIO" } } },
    { autoDjPolicies: { some: { rightsUse: "CORRECTIONS_RADIO" } } },
    { smartPlaylists: { some: { rightsUse: "CORRECTIONS_RADIO" } } },
    { generatedPlaylists: { some: { rightsUse: "CORRECTIONS_RADIO" } } },
    { rightsUsageLedgerEvents: { some: { rightsUse: "CORRECTIONS_RADIO" } } },
    { playoutIntents: { some: { OR: [
      "correctionsRequestId", "correctionsRehabContentId", "correctionsProgrammeId",
      "correctionsSubmissionId", "correctionsTrackId", "correctionsAnnouncementId",
      "correctionsOverrideId"
    ].map((field) => ({ [field]: { not: null } })) } } },
    ...directRelations.map((relation) => ({ [relation]: { some: {} } })),
    { proofOfPlayEvents: { some: { programmingSource: { startsWith: "CORRECTIONS_" } } } },
    { proofOfPlayEvents: { some: { itemType: "CORRECTIONS_AUDIO" } } },
    { auditLogs: { some: { action: { startsWith: "CORRECTIONS_" } } } }
  ];
  for (const marker of evidenceCases) {
    let wrote = false;
    let evidenceWhere;
    const tx = {
      $queryRaw: async () => [{ id: organisation.id }],
      organisation: {
        findUnique: async () => organisation,
        findFirst: async ({ where }) => {
          evidenceWhere = where;
          return where.id === organisation.id && where.OR.some((filter) => isDeepStrictEqual(filter, marker))
            ? { id: organisation.id } : null;
        },
        delete: async () => { wrote = true; }
      },
      billingInvoice: { count: async () => 0 },
      billingContract: { count: async () => 0 },
      auditLog: { create: async () => { wrote = true; } }
    };
    await assert.rejects(
      deleteTrialOrganisation({ $transaction: async (callback) => callback(tx) },
        { actor, organisationId: organisation.id, confirmation: "DELETE trial-shop" }),
      (error) => error.code === "CORRECTIONS_EVIDENCE_PRESENT",
      `Missing guard for ${Object.keys(marker)[0]}`
    );
    assert.equal(wrote, false, `${Object.keys(marker)[0]} must block every write`);
    assert.deepEqual(evidenceWhere, { id: organisation.id, OR: evidenceCases });
  }
});

test("trial deletion blocks Corrections Studio records without an Organisation relation", async () => {
  for (const model of ["studioPlayoutSession", "studioProgrammePack"]) {
    const calls = [];
    const tx = {
      $queryRaw: async () => [{ id: organisation.id }],
      organisation: {
        findUnique: async () => organisation,
        findFirst: async () => { calls.push("relational evidence"); return null; },
        delete: async () => { calls.push("delete"); }
      },
      billingInvoice: { count: async () => 0 },
      billingContract: { count: async () => 0 },
      studioPlayoutSession: { findFirst: async (query) => {
        calls.push(["studioPlayoutSession", query]);
        return model === "studioPlayoutSession" ? { id: "studio-1" } : null;
      } },
      studioProgrammePack: { findFirst: async (query) => {
        calls.push(["studioProgrammePack", query]);
        return { id: "pack-1" };
      } },
      auditLog: { create: async () => { calls.push("audit"); } }
    };
    await assert.rejects(
      deleteTrialOrganisation({ $transaction: async (callback) => callback(tx) },
        { actor, organisationId: organisation.id, confirmation: "DELETE trial-shop" }),
      (error) => error.code === "CORRECTIONS_EVIDENCE_PRESENT"
    );
    assert.equal(calls[0], "relational evidence");
    assert.deepEqual(calls[1], ["studioPlayoutSession", {
      where: { organisationId: organisation.id, productFamily: "CORRECTIONS" }, select: { id: true }
    }]);
    if (model === "studioPlayoutSession") assert.equal(calls.length, 2);
    else assert.deepEqual(calls[2], ["studioProgrammePack", {
      where: { organisationId: organisation.id, productFamily: "CORRECTIONS" }, select: { id: true }
    }]);
    assert.equal(calls.some((call) => call === "audit" || call === "delete"), false);
  }
});

test("organisation controls expose a Super Admin-only permanent deletion flow", async () => {
  const [route, control, page] = await Promise.all([
    readFile(new URL("../app/api/admin/organisations/[organisationId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/organisations/TrialOrganisationDeleteControl.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/organisations/page.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /access\.user\.role !== "SUPER_ADMIN"/);
  assert.match(route, /deleteTrialOrganisation/);
  assert.match(control, /DELETE \$\{organisationSlug\}/);
  assert.match(control, /User accounts remain/);
  assert.match(page, /TrialOrganisationDeleteControl/);
});
