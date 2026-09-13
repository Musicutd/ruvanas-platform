import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
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
    organisation: {
      findUnique: async () => organisation,
      delete: async () => { calls.push("organisation"); return organisation; }
    },
    billingInvoice: { count: async () => 0 },
    billingContract: { count: async () => 0 },
    auditLog: { create: async ({ data }) => { calls.push(data.action); return { id: "audit-1" }; } }
  };
  const result = await deleteTrialOrganisation({ $transaction: async (callback) => callback(tx) }, {
    actor,
    organisationId: organisation.id,
    confirmation: "DELETE trial-shop"
  });
  assert.deepEqual(calls, ["TRIAL_ORGANISATION_DELETED", "organisation"]);
  assert.equal(result.userAccountsDeleted, 0);
  assert.equal(result.memberLinksRemoved, 2);
});

test("single trial deletion blocks external billing evidence before deleting", async () => {
  let deleted = false;
  const tx = {
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
