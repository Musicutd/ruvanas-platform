import assert from "node:assert/strict";
import test from "node:test";
import {
  ComplimentaryRegistrationError,
  createComplimentaryRegistration,
  parseComplimentaryRegistrationRequest
} from "../lib/complimentary-registration.mjs";
import { generateComplimentaryCode, hashComplimentaryCode } from "../lib/complimentary-access.mjs";
import { findPublicPlan, publicPlanDatabaseData } from "../lib/product-plan-catalogue.mjs";

function plan() {
  const item = findPublicPlan("HEALTH_PRO");
  return { id: "plan-health-pro", ...publicPlanDatabaseData(item) };
}

function registration(code, overrides = {}) {
  return {
    code,
    name: "Eligible Owner",
    organisationName: "Eligible Health Service",
    email: "eligible@example.invalid",
    password: "correct-horse-battery-staple",
    ...overrides
  };
}

function database(code, overrides = {}) {
  const writes = { users: [], organisations: [], memberships: [], subscriptions: [], codes: [], audits: [] };
  const accessCode = {
    id: "free-code-1",
    codeHash: hashComplimentaryCode(code),
    codeSuffix: "ABCD",
    status: "ISSUED",
    organisationId: null,
    recipientEmail: "eligible@example.invalid",
    revokedAt: null,
    plan: plan(),
    ...overrides
  };
  const tx = {
    user: { findUnique: async () => null, create: async ({ data }) => { const value = { id: "user-1", ...data }; writes.users.push(value); return value; } },
    complimentaryAccessCode: {
      findUnique: async () => accessCode,
      updateMany: async ({ data }) => { writes.codes.push(data); return { count: accessCode.status === "ISSUED" ? 1 : 0 }; }
    },
    organisation: { create: async ({ data }) => { const value = { id: "org-1", ...data }; writes.organisations.push(value); return value; } },
    organisationMember: { create: async ({ data }) => { writes.memberships.push(data); return data; } },
    organisationMediaProfile: { create: async () => ({}) },
    subscription: { create: async ({ data }) => { const value = { id: "subscription-1", ...data }; writes.subscriptions.push(value); return value; } },
    auditLog: { create: async ({ data }) => { writes.audits.push(data); return data; } }
  };
  return {
    writes,
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, "Serializable");
      return operation(tx);
    }
  };
}

test("free-account registration validates code and account details", () => {
  const parsed = parseComplimentaryRegistrationRequest(registration(generateComplimentaryCode(), { email: " ELIGIBLE@EXAMPLE.INVALID " }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.email, "eligible@example.invalid");
  assert.equal(parseComplimentaryRegistrationRequest({ ...parsed.data, unexpected: true }).success, false);
});

test("an email-bound one-use code creates a complimentary account without trial or billing", async () => {
  const code = generateComplimentaryCode();
  const db = database(code);
  const result = await createComplimentaryRegistration(db, {
    registration: registration(code),
    passwordHash: "stored-password-hash"
  }, { now: new Date("2026-09-13T10:00:00.000Z"), suffixFactory: () => "eligible123" });

  assert.equal(result.recommendedDashboardRoute, "/dashboard/health");
  assert.equal(result.subscription.status, "SUSPENDED");
  assert.equal(result.subscription.currentPeriodEnd, null);
  assert.equal(result.subscription.complimentaryAccessActive, true);
  assert.equal(result.subscription.complimentaryPlanCode, "HEALTH_PRO");
  assert.equal(db.writes.codes[0].status, "ACTIVE");
  assert.equal(db.writes.codes[0].organisationId, "org-1");
  assert.equal(db.writes.audits[0].details.billingEventCreated, false);
  assert.equal(db.writes.audits[0].details.automaticExpiry, false);
  assert.equal(JSON.stringify(db.writes).includes(code), false);
  assert.equal(JSON.stringify(db.writes).includes("stored-password-hash"), true);
});

test("used and wrong-recipient codes fail closed", async () => {
  const code = generateComplimentaryCode();
  await assert.rejects(
    createComplimentaryRegistration(database(code, { status: "ACTIVE" }), { registration: registration(code), passwordHash: "hash" }),
    (error) => error instanceof ComplimentaryRegistrationError && error.code === "CODE_UNAVAILABLE"
  );
  await assert.rejects(
    createComplimentaryRegistration(database(code), { registration: registration(code, { email: "other@example.invalid" }), passwordHash: "hash" }),
    (error) => error instanceof ComplimentaryRegistrationError && error.code === "CODE_EMAIL_MISMATCH"
  );
});
