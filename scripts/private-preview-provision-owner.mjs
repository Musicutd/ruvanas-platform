import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { readPrivatePreviewPolicy } from "../lib/private-preview-policy.mjs";
import { runSerializableTransaction } from "../lib/transaction-retry.mjs";

const INVOCATION = "--provision-owner";
const CONFIRMATION = "PROVISION OWNER WITH EMPTY OWNER AND TENANT TABLES";
const TEMPLATE_CONFIRMATION = "PROVISION OWNER WITH EXACT THREE QA TEMPLATE TENANTS";
const DATABASE_NAME = /^ruvanas_private_preview_[0-9]{8}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const ALLOWED_DATABASE_PARAMETERS = new Set([
  "schema", "sslmode", "sslaccept", "connection_limit", "pool_timeout", "connect_timeout"
]);
const EMPTY_TABLES = [
  "user", "organisation", "subscription", "organisationMember",
  "organisationInvitation", "session", "passwordResetToken",
  "complimentaryAccessCode", "partnerDemoInvitation", "serviceAccount",
  "apiKey", "enterpriseIdentityProvider", "enterpriseIdentityLink",
  "billingAccount", "billingContract", "billingInvoice",
  "billingUsageReconciliation", "auditLog"
];
const TEMPLATE_SEEDS = [
  { organisationId: "qa-health-organisation", name: "Ruvanas Health QA",
    slug: "ruvanas-health-qa", subscriptionId: "qa-health-subscription",
    planId: "public-plan-health-pro", planCode: "HEALTH_PRO" },
  { organisationId: "qa-faith-organisation", name: "Ruvanas Faith QA",
    slug: "ruvanas-faith-qa", subscriptionId: "qa-faith-subscription",
    planId: "public-plan-faith-pro", planCode: "FAITH_PRO" },
  { organisationId: "qa-organisations-organisation", name: "Ruvanas Organisations QA",
    slug: "ruvanas-organisations-qa", subscriptionId: "qa-organisations-subscription",
    planId: "public-plan-organisations-pro", planCode: "ORGANISATIONS_PRO" }
];

function timestampMatches(left, right) {
  return left instanceof Date && right instanceof Date &&
    Number.isFinite(left.getTime()) && left.getTime() === right.getTime();
}

function tenYearPeriodMatches(createdAt, periodEnd) {
  if (!(createdAt instanceof Date) || !(periodEnd instanceof Date) ||
      !Number.isFinite(createdAt.getTime()) || !Number.isFinite(periodEnd.getTime())) return false;
  const year = createdAt.getUTCFullYear() + 10;
  const month = createdAt.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const expected = new Date(createdAt);
  expected.setUTCFullYear(year, month, Math.min(createdAt.getUTCDate(), lastDay));
  return periodEnd.getTime() === expected.getTime();
}

function exactTemplateSeeds(organisations, subscriptions) {
  if (organisations.length !== TEMPLATE_SEEDS.length ||
      subscriptions.length !== TEMPLATE_SEEDS.length) return false;
  const organisationById = new Map(organisations.map((row) => [row.id, row]));
  const subscriptionById = new Map(subscriptions.map((row) => [row.id, row]));
  if (organisationById.size !== TEMPLATE_SEEDS.length ||
      subscriptionById.size !== TEMPLATE_SEEDS.length) return false;
  for (const seed of TEMPLATE_SEEDS) {
    const organisation = organisationById.get(seed.organisationId);
    if (!organisation || organisation.name !== seed.name || organisation.slug !== seed.slug ||
        Object.keys(organisation).sort().join(",") !== "createdAt,id,name,slug,updatedAt" ||
        !timestampMatches(organisation.createdAt, organisation.updatedAt)) return false;
    const subscription = subscriptionById.get(seed.subscriptionId);
    if (!subscription || subscription.organisationId !== seed.organisationId ||
        subscription.planId !== seed.planId || subscription.plan?.code !== seed.planCode ||
        subscription.status !== "TRIAL" || subscription.complimentaryAccessActive !== false ||
        !timestampMatches(subscription.createdAt, subscription.updatedAt) ||
        !tenYearPeriodMatches(subscription.createdAt, subscription.currentPeriodEnd)) return false;
    const known = new Set(["id", "organisationId", "planId", "status", "currentPeriodEnd",
      "complimentaryAccessActive", "createdAt", "updatedAt", "plan"]);
    for (const [key, value] of Object.entries(subscription)) {
      if (!known.has(key) && value !== null) return false;
    }
  }
  return true;
}

function refusal(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function databaseIdentity(env) {
  const expectedName = env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME;
  const expectedHost = env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST;
  const rawUrl = env.DATABASE_URL;
  if (typeof expectedName !== "string" || !DATABASE_NAME.test(expectedName) ||
      typeof expectedHost !== "string" || !expectedHost ||
      expectedHost !== expectedHost.trim() ||
      typeof rawUrl !== "string" || !rawUrl || rawUrl !== rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl);
    const schemas = url.searchParams.getAll("schema");
    const sslMode = url.searchParams.get("sslmode");
    const sslAccept = url.searchParams.get("sslaccept");
    const parameters = [...url.searchParams.keys()];
    const externalRenderHost = url.hostname.endsWith(".render.com");
    if (!["postgresql:", "postgres:"].includes(url.protocol) || url.hash ||
        !url.hostname || url.hostname.endsWith(".") || LOOPBACK_HOSTS.has(url.hostname) ||
        url.hostname !== expectedHost ||
        decodeURIComponent(url.pathname.slice(1)) !== expectedName ||
        parameters.length !== new Set(parameters).size ||
        parameters.some((key) => !ALLOWED_DATABASE_PARAMETERS.has(key)) ||
        (sslAccept !== null && sslAccept !== "strict") ||
        (externalRenderHost && (sslMode !== "require" || sslAccept !== "strict")) ||
        schemas.length > 1 || (schemas.length === 1 && schemas[0] !== "public")) return null;
    return { databaseName: expectedName, databaseHost: expectedHost };
  } catch {
    return null;
  }
}

// No terminal requirement here: a separately trusted server operator may call
// the same guarded service after creating and verifying the isolated database.
export function privatePreviewOwnerProvisionPreflight(env = {}) {
  if (env.RUVANAS_PRIVATE_PREVIEW_OWNER_PROVISION_APPROVED !== "1" ||
      env.RUVANAS_ENVIRONMENT !== "PRIVATE_PREVIEW") {
    return { ok: false, code: "OPERATOR_APPROVAL_REQUIRED" };
  }
  const policy = readPrivatePreviewPolicy(env);
  if (!policy.enabled || !policy.valid || !policy.adminEmail ||
      !policy.allowedEmails.has(policy.adminEmail)) {
    return { ok: false, code: "PRIVATE_PREVIEW_CONFIG_UNAVAILABLE" };
  }
  const identity = databaseIdentity(env);
  if (!identity) return { ok: false, code: "DATABASE_IDENTITY_CONFIG_UNAVAILABLE" };
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) {
    return { ok: false, code: "SESSION_CONFIG_UNAVAILABLE" };
  }
  const templateApproval = env.RUVANAS_PRIVATE_PREVIEW_TEMPLATE_SEEDS_APPROVED;
  if (templateApproval !== undefined && templateApproval !== "0" && templateApproval !== "1") {
    return { ok: false, code: "TEMPLATE_SEED_APPROVAL_INVALID" };
  }
  return { ok: true, policy, ...identity, allowTemplateSeeds: templateApproval === "1" };
}

export function privatePreviewOwnerProvisionCliPreflight({
  args = [], stdinIsTTY = false, stdoutIsTTY = false, env = {}
} = {}) {
  if (!stdinIsTTY || !stdoutIsTTY) return { ok: false, code: "INTERACTIVE_TERMINAL_REQUIRED" };
  if (args.length !== 1 || args[0] !== INVOCATION) {
    return { ok: false, code: "EXPLICIT_INVOCATION_REQUIRED" };
  }
  return privatePreviewOwnerProvisionPreflight(env);
}

async function defaultDatabaseFactory(url) {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}

// The factory is only a test seam; the operator CLI uses the default factory,
// which binds Prisma to the URL that passed the exact-host/name preflight.
export async function provisionPrivatePreviewOwner({
  env = process.env, databaseFactory = defaultDatabaseFactory
} = {}) {
  const preflight = privatePreviewOwnerProvisionPreflight(env);
  if (!preflight.ok) throw refusal(preflight.code);

  let database;
  let result;
  let failure;
  try {
    database = await databaseFactory(env.DATABASE_URL);
    result = await runSerializableTransaction(database, async (tx) => {
      // In a serializable transaction, lock before the first SELECT so the
      // snapshot used by counts is not older than a concurrent writer that
      // committed while this transaction waited for the lock.
      await tx.$executeRaw`
        LOCK TABLE "User", "Organisation", "Subscription",
          "OrganisationMember", "OrganisationInvitation", "Session",
          "PasswordResetToken", "ComplimentaryAccessCode",
          "PartnerDemoInvitation", "ServiceAccount", "ApiKey",
          "EnterpriseIdentityProvider", "EnterpriseIdentityLink",
          "BillingAccount", "BillingContract", "BillingInvoice",
          "BillingUsageReconciliation", "AuditLog"
        IN SHARE ROW EXCLUSIVE MODE
      `;
      const identityRows = await tx.$queryRaw`
        SELECT current_database() AS "databaseName", current_schema() AS "schemaName"
      `;
      if (identityRows.length !== 1 ||
          identityRows[0].databaseName !== preflight.databaseName ||
          identityRows[0].schemaName !== "public") {
        throw refusal("DATABASE_IDENTITY_MISMATCH");
      }

      // All owner/tenant/account tables remain locked through the counts and
      // inserts. Only the separately approved six migration QA rows are exempt.
      for (const table of EMPTY_TABLES) {
        const templateTable = table === "organisation" || table === "subscription";
        const expected = preflight.allowTemplateSeeds && templateTable ? 3 : 0;
        if (await tx[table].count() !== expected) {
          throw refusal(preflight.allowTemplateSeeds && templateTable
            ? "TEMPLATE_SEEDS_MISMATCH" : "DATABASE_NOT_EMPTY");
        }
      }
      if (preflight.allowTemplateSeeds) {
        const organisations = await tx.organisation.findMany();
        const subscriptions = await tx.subscription.findMany({
          include: { plan: { select: { code: true } } }
        });
        if (!exactTemplateSeeds(organisations, subscriptions)) {
          throw refusal("TEMPLATE_SEEDS_MISMATCH");
        }
      }

      // This password is not displayed or retained. The only intended login
      // route is the separately issued, one-use owner code.
      const entropy = randomBytes(48);
      let password;
      let passwordHash;
      try {
        password = entropy.toString("base64url");
        passwordHash = await bcrypt.hash(password, 12);
      } finally {
        entropy.fill(0);
        password = undefined;
      }
      const owner = await tx.user.create({
        data: {
          email: preflight.policy.adminEmail,
          role: "SUPER_ADMIN",
          passwordHash
        },
        select: { id: true, email: true, role: true }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "PRIVATE_PREVIEW_OWNER_PROVISIONED",
          entityType: "User",
          entityId: owner.id
        }
      });
      return { ownerId: owner.id, role: owner.role };
    });
  } catch (error) {
    failure = typeof error?.code === "string" &&
      ["DATABASE_IDENTITY_MISMATCH", "DATABASE_NOT_EMPTY", "TEMPLATE_SEEDS_MISMATCH"].includes(error.code)
      ? error : refusal("OWNER_PROVISION_FAILED");
  } finally {
    if (database) {
      try {
        await database.$disconnect();
      } catch {
        failure = refusal("DATABASE_CLEANUP_UNVERIFIED");
      }
    }
  }
  if (failure) throw failure;
  return result;
}

async function run() {
  const env = process.env;
  const preflight = privatePreviewOwnerProvisionCliPreflight({
    args: process.argv.slice(2),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    env
  });
  if (!preflight.ok) {
    process.stderr.write(`Private preview owner provisioning refused: ${preflight.code}.\n`);
    process.exitCode = 1;
    return;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let confirmed = false;
  try {
    const phrase = preflight.allowTemplateSeeds ? TEMPLATE_CONFIRMATION : CONFIRMATION;
    const answer = await prompt.question(
      `Expected database: ${preflight.databaseName} on ${preflight.databaseHost}.\n` +
      `Type exactly '${phrase}' to create only the owner account: `
    );
    confirmed = answer === phrase;
  } finally {
    prompt.close();
  }
  if (!confirmed || !process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Private preview owner provisioning cancelled.\n");
    process.exitCode = 1;
    return;
  }
  try {
    await provisionPrivatePreviewOwner({ env });
    process.stdout.write("Private preview owner account created. Issue a one-use owner code separately.\n");
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z_]+$/.test(error.code)
      ? error.code : "OWNER_PROVISION_FAILED";
    process.stderr.write(`Private preview owner provisioning refused: ${code}.\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await run();
}
