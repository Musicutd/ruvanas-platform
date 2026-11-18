import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  privatePreviewOwnerProvisionCliPreflight,
  privatePreviewOwnerProvisionPreflight,
  provisionPrivatePreviewOwner
} from "../scripts/private-preview-provision-owner.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/private-preview-provision-owner.mjs", import.meta.url));
const VALID_ENV = {
  RUVANAS_PRIVATE_PREVIEW_OWNER_PROVISION_APPROVED: "1",
  RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
  RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@ruvanas.test",
  RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@ruvanas.test",
  RUVANAS_PUBLIC_URL: "https://private.ruvanas.test",
  RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME: "ruvanas_private_preview_20261011",
  RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST: "dpg-synthetic-preview.render.test",
  DATABASE_URL: "postgresql://synthetic:synthetic@dpg-synthetic-preview.render.test/ruvanas_private_preview_20261011?schema=public",
  SESSION_SECRET: "synthetic-preview-session-secret-32-bytes-minimum",
  NODE_ENV: "production"
};

function syntheticDatabase({ databaseName = VALID_ENV.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME,
  schemaName = "public", nonempty = null, disconnectFails = false,
  templateRows = null, countOverrides = {} } = {}) {
  const events = [];
  const counts = ["user", "organisation", "subscription", "organisationMember",
    "organisationInvitation", "session", "passwordResetToken", "complimentaryAccessCode",
    "partnerDemoInvitation", "serviceAccount", "apiKey",
    "enterpriseIdentityProvider", "enterpriseIdentityLink",
    "billingAccount", "billingContract", "billingInvoice",
    "billingUsageReconciliation", "auditLog"];
  const tx = {
    $queryRaw: async () => {
      events.push("identity");
      return [{ databaseName, schemaName }];
    },
    $executeRaw: async () => {
      events.push("lock");
      return 0;
    }
  };
  for (const table of counts) {
    tx[table] = {
      count: async () => {
        events.push(`count:${table}`);
        if (Object.hasOwn(countOverrides, table)) return countOverrides[table];
        if (table === nonempty) return 1;
        return templateRows && ["organisation", "subscription"].includes(table) ? 3 : 0;
      }
    };
  }
  tx.organisation.findMany = async () => {
    events.push("findMany:organisation");
    return templateRows.organisations;
  };
  tx.subscription.findMany = async (args) => {
    events.push("findMany:subscription");
    assert.deepEqual(args, { include: { plan: { select: { code: true } } } });
    return templateRows.subscriptions;
  };
  tx.user.create = async ({ data, select }) => {
    events.push("create:user");
    assert.equal(data.email, "owner@ruvanas.test");
    assert.equal(data.role, "SUPER_ADMIN");
    assert.match(data.passwordHash, /^\$2[aby]\$12\$/);
    assert.deepEqual(select, { id: true, email: true, role: true });
    return { id: "owner-1", email: data.email, role: data.role };
  };
  tx.auditLog.create = async ({ data }) => {
    events.push("create:auditLog");
    assert.deepEqual(data, {
      actorUserId: "owner-1",
      action: "PRIVATE_PREVIEW_OWNER_PROVISIONED",
      entityType: "User",
      entityId: "owner-1"
    });
  };
  const database = {
    $transaction: async (operation, options) => {
      events.push("transaction");
      assert.deepEqual(options, { isolationLevel: "Serializable" });
      return operation(tx);
    },
    $disconnect: async () => {
      events.push("disconnect");
      if (disconnectFails) throw Error("synthetic cleanup failure");
    }
  };
  return { database, events, counts };
}

function exactTemplateRows() {
  const createdAt = new Date("2026-10-11T10:00:00.000Z");
  const currentPeriodEnd = new Date("2036-10-11T10:00:00.000Z");
  const seeds = [
    ["health", "Health", "HEALTH_PRO", "public-plan-health-pro"],
    ["faith", "Faith", "FAITH_PRO", "public-plan-faith-pro"],
    ["organisations", "Organisations", "ORGANISATIONS_PRO", "public-plan-organisations-pro"]
  ];
  return {
    organisations: seeds.map(([key, label]) => ({
      id: `qa-${key}-organisation`, name: `Ruvanas ${label} QA`,
      slug: `ruvanas-${key}-qa`, createdAt, updatedAt: createdAt
    })),
    subscriptions: seeds.map(([key, , code, planId]) => ({
      id: `qa-${key}-subscription`, organisationId: `qa-${key}-organisation`,
      planId, plan: { code }, status: "TRIAL", currentPeriodEnd,
      createdAt, updatedAt: createdAt, complimentaryAccessActive: false,
      retailRadioEnabled: null, complimentaryAccessCodeId: null
    }))
  };
}

test("CLI refuses pipes before reading configuration or importing Prisma", () => {
  const unreadableEnv = new Proxy({}, {
    get() { throw Error("environment read before terminal gate"); }
  });
  assert.deepEqual(privatePreviewOwnerProvisionCliPreflight({
    args: ["--provision-owner"], env: unreadableEnv
  }), { ok: false, code: "INTERACTIVE_TERMINAL_REQUIRED" });
  const child = spawnSync(process.execPath, [SCRIPT, "--provision-owner"], {
    input: "", encoding: "utf8", env: {}
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /INTERACTIVE_TERMINAL_REQUIRED/);
  assert.equal(child.stdout, "");
});

test("preflight requires explicit owner-only, preview-only identity and secret gates", () => {
  assert.equal(privatePreviewOwnerProvisionCliPreflight({
    args: [], stdinIsTTY: true, stdoutIsTTY: true, env: VALID_ENV
  }).code, "EXPLICIT_INVOCATION_REQUIRED");
  const invalid = [
    ["RUVANAS_PRIVATE_PREVIEW_OWNER_PROVISION_APPROVED", "0", "OPERATOR_APPROVAL_REQUIRED"],
    ["RUVANAS_ENVIRONMENT", "PRODUCTION", "OPERATOR_APPROVAL_REQUIRED"],
    ["RUVANAS_PRIVATE_PREVIEW_ENABLED", "0", "PRIVATE_PREVIEW_CONFIG_UNAVAILABLE"],
    ["RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL", "other@example.test", "PRIVATE_PREVIEW_CONFIG_UNAVAILABLE"],
    ["RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME", "ruvanas_production", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST", "production.render.test", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["DATABASE_URL", "postgresql://synthetic:synthetic@127.0.0.1/ruvanas_private_preview_20261011", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["DATABASE_URL", "postgresql://synthetic:synthetic@dpg-synthetic-preview.render.test/ruvanas_production", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["DATABASE_URL", "postgresql://synthetic:synthetic@dpg-synthetic-preview.render.test/ruvanas_private_preview_20261011?schema=other", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["DATABASE_URL", "postgresql://synthetic:synthetic@dpg-synthetic-preview.render.test/ruvanas_private_preview_20261011?schema=public&schema=other", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["DATABASE_URL", "postgresql://synthetic:synthetic@dpg-synthetic-preview.render.test/ruvanas_private_preview_20261011?host=%2Ftmp%2Fpg", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["DATABASE_URL", "postgresql://synthetic:synthetic@dpg-synthetic-preview.render.test/ruvanas_private_preview_20261011?target_session_attrs=read-write", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["DATABASE_URL", "postgresql://synthetic:synthetic@dpg-synthetic-preview.render.test/ruvanas_private_preview_20261011?sslmode=require&sslaccept=accept_invalid_certs", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["DATABASE_URL", "postgresql://synthetic:synthetic@dpg-synthetic-preview.render.test/ruvanas_private_preview_20261011?sslmode=require&sslaccept=other", "DATABASE_IDENTITY_CONFIG_UNAVAILABLE"],
    ["SESSION_SECRET", "short", "SESSION_CONFIG_UNAVAILABLE"]
  ];
  for (const [key, value, code] of invalid) {
    assert.equal(privatePreviewOwnerProvisionPreflight({ ...VALID_ENV, [key]: value }).code,
      code, key);
  }
  const valid = privatePreviewOwnerProvisionPreflight(VALID_ENV);
  assert.equal(valid.ok, true);
  assert.equal(valid.databaseName, "ruvanas_private_preview_20261011");
  assert.equal(valid.databaseHost, "dpg-synthetic-preview.render.test");
  assert.equal(Object.hasOwn(valid, "DATABASE_URL"), false);
  assert.equal(Object.hasOwn(valid, "SESSION_SECRET"), false);
  assert.equal(privatePreviewOwnerProvisionPreflight({ ...VALID_ENV,
    DATABASE_URL: `${VALID_ENV.DATABASE_URL}&sslmode=require&sslaccept=strict`
  }).ok, true);
  const externalHost = "dpg-synthetic.frankfurt-postgres.render.com";
  const externalUrl = `postgresql://synthetic:synthetic@${externalHost}/ruvanas_private_preview_20261011`;
  const externalEnv = { ...VALID_ENV,
    RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST: externalHost
  };
  assert.equal(privatePreviewOwnerProvisionPreflight({ ...externalEnv,
    DATABASE_URL: `${externalUrl}?sslmode=require&sslaccept=strict`
  }).ok, true);
  for (const query of ["", "?sslmode=require", "?sslaccept=strict",
    "?sslmode=prefer&sslaccept=strict", "?sslmode=require&sslaccept=accept_invalid_certs"]) {
    assert.equal(privatePreviewOwnerProvisionPreflight({ ...externalEnv,
      DATABASE_URL: `${externalUrl}${query}`
    }).code, "DATABASE_IDENTITY_CONFIG_UNAVAILABLE", query);
  }
  assert.equal(privatePreviewOwnerProvisionPreflight({ ...VALID_ENV,
    RUVANAS_PRIVATE_PREVIEW_TEMPLATE_SEEDS_APPROVED: "1"
  }).allowTemplateSeeds, true);
  assert.equal(privatePreviewOwnerProvisionPreflight({ ...VALID_ENV,
    RUVANAS_PRIVATE_PREVIEW_TEMPLATE_SEEDS_APPROVED: "yes"
  }).code, "TEMPLATE_SEED_APPROVAL_INVALID");
});

test("invalid preflight cannot call the database factory", async () => {
  await assert.rejects(provisionPrivatePreviewOwner({
    env: { ...VALID_ENV, RUVANAS_ENVIRONMENT: "PRODUCTION" },
    databaseFactory: async () => { throw Error("factory must not be called"); }
  }), { code: "OPERATOR_APPROVAL_REQUIRED" });
});

test("verified empty owner and tenant tables insert exactly an owner and audit row", async () => {
  const { database, events, counts } = syntheticDatabase();
  const result = await provisionPrivatePreviewOwner({
    env: VALID_ENV,
    databaseFactory: async (url) => {
      assert.equal(url, VALID_ENV.DATABASE_URL);
      return database;
    }
  });
  assert.deepEqual(result, { ownerId: "owner-1", role: "SUPER_ADMIN" });
  assert.deepEqual(events, ["transaction", "lock", "identity",
    ...counts.map((table) => `count:${table}`),
    "create:user", "create:auditLog", "disconnect"]);
});

test("wrong runtime database/schema and any existing account abort before creation", async () => {
  for (const fixture of [
    { databaseName: "ruvanas_production", code: "DATABASE_IDENTITY_MISMATCH" },
    { schemaName: "other", code: "DATABASE_IDENTITY_MISMATCH" },
    { nonempty: "user", code: "DATABASE_NOT_EMPTY" },
    { nonempty: "subscription", code: "DATABASE_NOT_EMPTY" },
    { nonempty: "billingAccount", code: "DATABASE_NOT_EMPTY" },
    { nonempty: "apiKey", code: "DATABASE_NOT_EMPTY" }
  ]) {
    const { database, events } = syntheticDatabase(fixture);
    await assert.rejects(provisionPrivatePreviewOwner({
      env: VALID_ENV, databaseFactory: async () => database
    }), { code: fixture.code });
    assert.equal(events.includes("create:user"), false);
    assert.equal(events.includes("create:auditLog"), false);
    assert.equal(events.at(-1), "disconnect");
  }
});

test("cleanup ambiguity never reports a successful provisioning result", async () => {
  const { database } = syntheticDatabase({ disconnectFails: true });
  await assert.rejects(provisionPrivatePreviewOwner({
    env: VALID_ENV, databaseFactory: async () => database
  }), { code: "DATABASE_CLEANUP_UNVERIFIED" });
});

test("explicitly approved exact migration QA templates permit only owner and audit inserts", async () => {
  const rows = exactTemplateRows();
  const { database, events, counts } = syntheticDatabase({ templateRows: rows });
  const env = { ...VALID_ENV, RUVANAS_PRIVATE_PREVIEW_TEMPLATE_SEEDS_APPROVED: "1" };
  const result = await provisionPrivatePreviewOwner({
    env, databaseFactory: async () => database
  });
  assert.deepEqual(result, { ownerId: "owner-1", role: "SUPER_ADMIN" });
  assert.deepEqual(events, ["transaction", "lock", "identity",
    ...counts.map((table) => `count:${table}`),
    "findMany:organisation", "findMany:subscription",
    "create:user", "create:auditLog", "disconnect"]);

  const defaultMode = syntheticDatabase({ templateRows: rows });
  await assert.rejects(provisionPrivatePreviewOwner({
    env: VALID_ENV, databaseFactory: async () => defaultMode.database
  }), { code: "DATABASE_NOT_EMPTY" });
  assert.equal(defaultMode.events.includes("create:user"), false);
});

test("seed approval refuses extra, missing, modified, or privileged QA records", async () => {
  const env = { ...VALID_ENV, RUVANAS_PRIVATE_PREVIEW_TEMPLATE_SEEDS_APPROVED: "1" };
  const mutations = [
    { countOverrides: { organisation: 4 }, code: "TEMPLATE_SEEDS_MISMATCH" },
    { countOverrides: { subscription: 2 }, code: "TEMPLATE_SEEDS_MISMATCH" },
    { nonempty: "user", code: "DATABASE_NOT_EMPTY" },
    { mutate: (rows) => { rows.organisations[0].name = "Edited Health"; } },
    { mutate: (rows) => { rows.subscriptions[0].organisationId = "qa-faith-organisation"; } },
    { mutate: (rows) => { rows.subscriptions[0].plan.code = "HEALTH_ENTERPRISE"; } },
    { mutate: (rows) => { rows.subscriptions[0].status = "ACTIVE"; } },
    { mutate: (rows) => { rows.subscriptions[0].currentPeriodEnd = new Date("2040-01-01T00:00:00Z"); } },
    { mutate: (rows) => { rows.subscriptions[0].complimentaryAccessActive = true; } },
    { mutate: (rows) => { rows.subscriptions[0].retailRadioEnabled = true; } }
  ];
  for (const mutation of mutations) {
    const rows = exactTemplateRows();
    mutation.mutate?.(rows);
    const { database, events } = syntheticDatabase({ templateRows: rows,
      countOverrides: mutation.countOverrides, nonempty: mutation.nonempty });
    await assert.rejects(provisionPrivatePreviewOwner({
      env, databaseFactory: async () => database
    }), { code: mutation.code ?? "TEMPLATE_SEEDS_MISMATCH" });
    assert.equal(events.includes("create:user"), false);
    assert.equal(events.includes("create:auditLog"), false);
    assert.equal(events.at(-1), "disconnect");
  }
});
