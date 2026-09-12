import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  findPublicPlan,
  RUVANAS_PRODUCTS
} from "./product-plan-catalogue.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export const REGISTRATION_SOURCES = Object.freeze([
  "DIRECT",
  "PRICING_PAGE",
  "ADMIN_TEST"
]);

const registrationRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  organisationName: z.string().trim().min(1).max(160),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(200),
  product: z.preprocess(
    (value) => typeof value === "string" ? value.trim().toUpperCase() : value,
    z.enum(RUVANAS_PRODUCTS)
  ),
  tier: z.string().trim().min(2).max(64),
  source: z.preprocess(
    (value) => typeof value === "string" && value.trim()
      ? value.trim().toUpperCase()
      : "DIRECT",
    z.enum(REGISTRATION_SOURCES)
  )
}).strict();

const PRODUCT_LANDING_ROUTES = Object.freeze({
  RETAIL: "/dashboard/retail",
  SCHOOL: "/dashboard/school",
  ONLINE: "/dashboard/radio",
  HEALTH: "/dashboard/health",
  FAITH: "/dashboard/faith"
});

const PRODUCT_CAPABILITY_FIELDS = Object.freeze({
  RETAIL: "retailRadioEnabled",
  SCHOOL: "schoolRadioEnabled",
  ONLINE: "onlineRadioEnabled",
  HEALTH: "healthRadioEnabled",
  FAITH: "faithRadioEnabled"
});

const PUBLIC_MESSAGES = Object.freeze({
  EMAIL_EXISTS: "An account with this email already exists.",
  ENTERPRISE_CONTACT_REQUIRED: "This plan needs a tailored setup. Please contact Ruvanas to continue.",
  INVALID_PLAN: "Please choose an available plan for your selected Ruvanas service.",
  PLAN_CONFIGURATION_ERROR: "This plan is temporarily unavailable. Please choose another plan or contact Ruvanas.",
  PLAN_UNAVAILABLE: "This plan is currently unavailable. Please choose another plan or contact Ruvanas.",
  PRODUCT_PLAN_MISMATCH: "The selected plan does not belong to the chosen Ruvanas service."
});

export class ProductRegistrationError extends Error {
  constructor(code, status = 400) {
    super(PUBLIC_MESSAGES[code] || "Unable to complete registration.");
    this.name = "ProductRegistrationError";
    this.code = code;
    this.status = status;
  }
}

export function parseRegistrationRequest(input) {
  return registrationRequestSchema.safeParse(input);
}

export function registrationLandingRoute(product) {
  return PRODUCT_LANDING_ROUTES[String(product || "").trim().toUpperCase()] || "/dashboard/account";
}

function normaliseTier(value) {
  return String(value || "").trim().toLowerCase();
}

function planMatchesProductCapability(plan, product) {
  const expectedField = PRODUCT_CAPABILITY_FIELDS[product];
  if (!expectedField || plan?.[expectedField] !== true) return false;

  return [
    plan.retailRadioEnabled,
    plan.schoolRadioEnabled,
    plan.onlineRadioEnabled,
    plan.healthRadioEnabled,
    plan.faithRadioEnabled
  ].filter(Boolean).length === 1;
}

export async function resolveRegistrationPlan(database, { product, tier }) {
  const selectedProduct = String(product || "").trim().toUpperCase();
  const selectedTier = normaliseTier(tier);
  const cataloguePlan = findPublicPlan(selectedTier, selectedProduct);

  if (!cataloguePlan) {
    const planForAnotherProduct = findPublicPlan(selectedTier);
    throw new ProductRegistrationError(
      planForAnotherProduct ? "PRODUCT_PLAN_MISMATCH" : "INVALID_PLAN"
    );
  }

  if (cataloguePlan.enterpriseContactRequired) {
    throw new ProductRegistrationError("ENTERPRISE_CONTACT_REQUIRED", 422);
  }

  const plan = await database.plan.findUnique({
    where: { code: cataloguePlan.code }
  });

  if (!plan || !plan.active || !plan.publiclyAvailable) {
    throw new ProductRegistrationError("PLAN_UNAVAILABLE", 409);
  }

  if (
    plan.productFamily !== selectedProduct ||
    normaliseTier(plan.publicSlug) !== cataloguePlan.publicSlug ||
    !planMatchesProductCapability(plan, selectedProduct)
  ) {
    throw new ProductRegistrationError("PLAN_CONFIGURATION_ERROR", 409);
  }

  return { plan, cataloguePlan };
}

function defaultSuffix() {
  return randomBytes(5).toString("hex");
}

function createOrganisationSlug(value, suffix) {
  const base = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "ruvanas-client";
  const safeSuffix = String(suffix || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16) || defaultSuffix();
  return `${base}-${safeSuffix}`;
}

export async function createProductRegistration(
  database,
  { registration, passwordHash },
  { now = new Date(), suffixFactory = defaultSuffix } = {}
) {
  const trialEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return runSerializableTransaction(database, async (tx) => {
    const existingUser = await tx.user.findUnique({
      where: { email: registration.email },
      select: { id: true }
    });
    if (existingUser) throw new ProductRegistrationError("EMAIL_EXISTS", 409);

    const { plan, cataloguePlan } = await resolveRegistrationPlan(tx, registration);
    const organisationSlug = createOrganisationSlug(
      registration.organisationName,
      suffixFactory()
    );

    const user = await tx.user.create({
      data: {
        name: registration.name,
        email: registration.email,
        passwordHash,
        role: "OWNER"
      }
    });

    const organisation = await tx.organisation.create({
      data: {
        name: registration.organisationName,
        slug: organisationSlug
      }
    });

    await tx.organisationMember.create({
      data: {
        userId: user.id,
        organisationId: organisation.id,
        role: "OWNER"
      }
    });

    const subscription = await tx.subscription.create({
      data: {
        organisationId: organisation.id,
        planId: plan.id,
        status: "TRIAL",
        currentPeriodEnd: trialEndsAt
      }
    });

    await tx.auditLog.create({
      data: {
        organisationId: organisation.id,
        actorUserId: user.id,
        action: "ACCOUNT_REGISTERED",
        entityType: "User",
        entityId: user.id,
        details: {
          productFamily: cataloguePlan.productFamily,
          planCode: cataloguePlan.code,
          registrationSource: registration.source,
          trialState: "TRIAL"
        }
      }
    });

    return {
      user,
      organisation,
      subscription,
      plan: {
        id: plan.id,
        code: cataloguePlan.code,
        publicSlug: cataloguePlan.publicSlug,
        name: cataloguePlan.name,
        productFamily: cataloguePlan.productFamily,
        tierNumber: cataloguePlan.tierNumber
      },
      trialEndsAt,
      recommendedDashboardRoute: registrationLandingRoute(cataloguePlan.productFamily)
    };
  });
}
