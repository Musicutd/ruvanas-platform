import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductRegistration,
  parseRegistrationRequest,
  ProductRegistrationError,
  registrationLandingRoute,
  resolveRegistrationPlan
} from "../lib/product-registration.mjs";
import {
  findPublicPlan,
  publicPlanDatabaseData
} from "../lib/product-plan-catalogue.mjs";

function databasePlan(code, overrides = {}) {
  const cataloguePlan = findPublicPlan(code);
  return {
    id: `plan-${cataloguePlan.code.toLowerCase()}`,
    ...publicPlanDatabaseData(cataloguePlan),
    ...overrides
  };
}

function createRegistrationDatabase(plan) {
  const writes = {
    users: [],
    organisations: [],
    memberships: [],
    subscriptions: [],
    audits: []
  };
  const tx = {
    plan: {
      async findUnique({ where }) {
        return where.code === plan.code ? plan : null;
      }
    },
    user: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        const user = { id: `user-${writes.users.length + 1}`, ...data };
        writes.users.push(user);
        return user;
      }
    },
    organisation: {
      async create({ data }) {
        const organisation = { id: `organisation-${writes.organisations.length + 1}`, ...data };
        writes.organisations.push(organisation);
        return organisation;
      }
    },
    organisationMember: {
      async create({ data }) {
        writes.memberships.push(data);
        return { id: `membership-${writes.memberships.length}`, ...data };
      }
    },
    subscription: {
      async create({ data }) {
        const subscription = { id: `subscription-${writes.subscriptions.length + 1}`, ...data };
        writes.subscriptions.push(subscription);
        return subscription;
      }
    },
    auditLog: {
      async create({ data }) {
        writes.audits.push(data);
        return { id: `audit-${writes.audits.length}`, ...data };
      }
    }
  };

  return {
    writes,
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, "Serializable");
      return operation(tx);
    }
  };
}

function registration(overrides = {}) {
  return {
    name: "Ruvanas QA Owner",
    organisationName: "Ruvanas QA Organisation",
    email: "qa@example.invalid",
    password: "correct-horse-battery-staple",
    product: "RETAIL",
    tier: "retail-start",
    source: "DIRECT",
    ...overrides
  };
}

test("registration request validation requires and normalises product, tier and source", () => {
  const parsed = parseRegistrationRequest(registration({
    email: "  QA@Example.Invalid ",
    product: " retail ",
    source: " pricing_page "
  }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.email, "qa@example.invalid");
  assert.equal(parsed.data.product, "RETAIL");
  assert.equal(parsed.data.source, "PRICING_PAGE");

  const defaultSource = parseRegistrationRequest(registration({ source: undefined }));
  assert.equal(defaultSource.success, true);
  assert.equal(defaultSource.data.source, "DIRECT");

  for (const payload of [
    registration({ product: undefined }),
    registration({ product: "EVERYTHING" }),
    registration({ tier: "" }),
    registration({ source: "UNBOUNDED_ATTRIBUTION" }),
    { ...registration(), unexpectedLimit: 999999 }
  ]) {
    assert.equal(parseRegistrationRequest(payload).success, false);
  }
});

test("registration plans resolve only from active matching public database rows", async () => {
  const activeRetail = databasePlan("RETAIL_PROFESSIONAL");
  const database = { plan: { findUnique: async () => activeRetail } };
  const resolved = await resolveRegistrationPlan(database, {
    product: "RETAIL",
    tier: "retail-professional"
  });
  assert.equal(resolved.plan.id, activeRetail.id);
  assert.equal(resolved.cataloguePlan.code, "RETAIL_PROFESSIONAL");

  await assert.rejects(
    resolveRegistrationPlan(database, { product: "SCHOOL", tier: "retail-professional" }),
    (error) => error instanceof ProductRegistrationError && error.code === "PRODUCT_PLAN_MISMATCH"
  );
  await assert.rejects(
    resolveRegistrationPlan(database, { product: "RETAIL", tier: "invented-tier" }),
    (error) => error.code === "INVALID_PLAN"
  );
  await assert.rejects(
    resolveRegistrationPlan(database, { product: "RETAIL", tier: "retail-enterprise" }),
    (error) => error.code === "ENTERPRISE_CONTACT_REQUIRED" && error.status === 422
  );
  await assert.rejects(
    resolveRegistrationPlan(
      { plan: { findUnique: async () => ({ ...activeRetail, active: false }) } },
      { product: "RETAIL", tier: "retail-professional" }
    ),
    (error) => error.code === "PLAN_UNAVAILABLE"
  );
  await assert.rejects(
    resolveRegistrationPlan(
      { plan: { findUnique: async () => ({ ...activeRetail, onlineRadioEnabled: true }) } },
      { product: "RETAIL", tier: "retail-professional" }
    ),
    (error) => error.code === "PLAN_CONFIGURATION_ERROR"
  );
});

test("Retail, School and Online registrations atomically create the correct subscription and audit evidence", async () => {
  const cases = [
    ["RETAIL", "retail-professional", "RETAIL_PROFESSIONAL", "/dashboard/retail"],
    ["SCHOOL", "school-pro", "SCHOOL_PRO", "/dashboard/school"],
    ["ONLINE", "online-professional", "ONLINE_PROFESSIONAL", "/dashboard/radio"]
  ];
  const now = new Date("2026-09-07T10:00:00.000Z");

  for (const [product, tier, planCode, route] of cases) {
    const database = createRegistrationDatabase(databasePlan(planCode));
    const result = await createProductRegistration(
      database,
      {
        registration: registration({
          email: `${product.toLowerCase()}@example.invalid`,
          product,
          tier,
          source: "PRICING_PAGE"
        }),
        passwordHash: "stored-password-hash"
      },
      { now, suffixFactory: () => `${product.toLowerCase()}123` }
    );

    assert.equal(result.plan.code, planCode);
    assert.equal(result.recommendedDashboardRoute, route);
    assert.equal(result.subscription.planId, databasePlan(planCode).id);
    assert.equal(result.subscription.status, "TRIAL");
    assert.equal(result.trialEndsAt.toISOString(), "2026-10-07T10:00:00.000Z");
    assert.equal(database.writes.users.length, 1);
    assert.equal(database.writes.organisations.length, 1);
    assert.equal(database.writes.memberships.length, 1);
    assert.equal(database.writes.subscriptions.length, 1);
    assert.equal(database.writes.audits.length, 1);
    assert.deepEqual(database.writes.audits[0].details, {
      productFamily: product,
      planCode,
      registrationSource: "PRICING_PAGE",
      trialState: "TRIAL"
    });
    assert.equal(JSON.stringify(database.writes.audits).includes("stored-password-hash"), false);
  }
});

test("duplicate-email races retain the established retry protection and finish with a safe conflict", async () => {
  let transactionAttempts = 0;
  let lookupAttempts = 0;
  const duplicate = Object.assign(new Error("unique constraint"), { code: "P2002" });
  const tx = {
    user: {
      async findUnique() {
        lookupAttempts += 1;
        return lookupAttempts === 1 ? null : { id: "existing-user" };
      },
      async create() {
        throw duplicate;
      }
    },
    plan: { findUnique: async () => databasePlan("RETAIL_START") }
  };
  const database = {
    async $transaction(operation) {
      transactionAttempts += 1;
      return operation(tx);
    }
  };

  await assert.rejects(
    createProductRegistration(database, {
      registration: registration(),
      passwordHash: "stored-password-hash"
    }),
    (error) => error.code === "EMAIL_EXISTS" && error.status === 409
  );
  assert.equal(transactionAttempts, 2);
});

test("registration landing routes remain explicit and fail closed", () => {
  assert.equal(registrationLandingRoute("RETAIL"), "/dashboard/retail");
  assert.equal(registrationLandingRoute("school"), "/dashboard/school");
  assert.equal(registrationLandingRoute("ONLINE"), "/dashboard/radio");
  assert.equal(registrationLandingRoute("MULTI"), "/dashboard/account");
});
