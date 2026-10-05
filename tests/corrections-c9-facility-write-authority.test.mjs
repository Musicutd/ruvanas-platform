import assert from "node:assert/strict";
import test from "node:test";
import { correctionsCurrentFacilityEdit } from "../lib/corrections-facility-write-authority.mjs";

const access = { organisationId: "org-a", memberId: "member-a", facilityId: "facility-a" };

function transaction({ role = "MANAGER", locationStatus = "ACTIVE", facility = true, permission = "MANAGER",
  subscriptionStatus = "ACTIVE", planActive = true, tierNumber = 3 } = {}) {
  const queries = [];
  return {
    queries,
    tx: {
      $queryRaw: async (segments, ...values) => {
        const sql = segments.join("?");
        queries.push({ sql, values });
        if (sql.includes('FROM "OrganisationMember"')) return role ? [{ role }] : [];
        if (sql.includes('FROM "Location"')) return locationStatus ? [{ status: locationStatus }] : [];
        if (sql.includes('FROM "CorrectionsFacilityGrant"')) return permission ? [{ permission }] : [];
        if (sql.includes('FROM "Subscription"')) return subscriptionStatus ? [{ planId: "plan-a" }] : [];
        if (sql.includes('FROM "Plan"')) return planActive === null ? [] : [{ id: "plan-a" }];
        throw new Error(`Unexpected authority query: ${sql}`);
      },
      correctionsFacility: { findUnique: async () => facility ? { locationId: access.facilityId } : null },
      subscription: { findUnique: async () => subscriptionStatus ? {
        status: subscriptionStatus,
        plan: { active: planActive, productFamily: "CORRECTIONS", tierNumber, correctionsRadioEnabled: true }
      } : null }
    }
  };
}

test("facility writes use locked, currently matching member and grant records", async () => {
  const { tx, queries } = transaction();
  const current = await correctionsCurrentFacilityEdit(tx, access);
  assert.equal(current.role, "MANAGER");
  assert.equal(current.entitlements.planTierNumber, 3);
  assert.equal(queries.length, 5);
  assert.ok(queries.every(({ sql }) => sql.includes("FOR UPDATE") || sql.includes("FOR SHARE")));
  assert.deepEqual(queries[2].values, [access.organisationId, access.memberId, access.facilityId]);
});

test("revoked or downgraded facility authority cannot continue a queued write", async () => {
  for (const changes of [
    { role: null },
    { role: "VIEWER" },
    { locationStatus: "CLOSED" },
    { facility: false },
    { permission: null },
    { permission: "VIEWER" },
    { subscriptionStatus: null },
    { subscriptionStatus: "CANCELLED" },
    { planActive: null },
    { planActive: false }
  ]) {
    const { tx } = transaction(changes);
    assert.equal(await correctionsCurrentFacilityEdit(tx, access), null, JSON.stringify(changes));
  }
});

test("only a current owner may change owner-only broadcast policy", async () => {
  const owner = transaction({ role: "OWNER", permission: null });
  assert.equal((await correctionsCurrentFacilityEdit(owner.tx, { ...access, ownerOnly: true })).role, "OWNER");
  assert.equal(owner.queries.length, 4);
  const manager = transaction();
  assert.equal(await correctionsCurrentFacilityEdit(manager.tx, { ...access, ownerOnly: true }), null);
  assert.equal(manager.queries.length, 1);
});
