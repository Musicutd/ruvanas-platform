import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  complimentaryPlanSnapshot,
  hashComplimentaryCode,
  normaliseComplimentaryCode
} from "./complimentary-access.mjs";
import { organisationTemplate } from "./organisations-core.mjs";
import { findPublicPlan } from "./product-plan-catalogue.mjs";
import { registrationLandingRoute } from "./product-registration.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

const requestSchema = z.object({
  code: z.string().trim().min(12).max(80),
  name: z.string().trim().min(1).max(120),
  organisationName: z.string().trim().min(1).max(160),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(200),
  organisationTemplate: z.string().trim().max(40).optional()
}).strict();

const PUBLIC_MESSAGES = Object.freeze({
  CODE_EMAIL_MISMATCH: "This code was issued for a different email address.",
  CODE_UNAVAILABLE: "This free-access code is invalid, already used, or has been disabled.",
  EMAIL_EXISTS: "An account with this email already exists.",
  PLAN_UNAVAILABLE: "The service attached to this code is currently unavailable. Please contact Ruvanas."
});

export class ComplimentaryRegistrationError extends Error {
  constructor(code, status = 400) {
    super(PUBLIC_MESSAGES[code] || "Unable to create the free account.");
    this.name = "ComplimentaryRegistrationError";
    this.code = code;
    this.status = status;
  }
}

export function parseComplimentaryRegistrationRequest(input) {
  return requestSchema.safeParse(input);
}

function defaultSuffix() {
  return randomBytes(5).toString("hex");
}

function organisationSlug(value, suffix) {
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

export async function createComplimentaryRegistration(
  database,
  { registration, passwordHash },
  { now = new Date(), suffixFactory = defaultSuffix } = {}
) {
  const codeHash = hashComplimentaryCode(registration.code);
  if (!codeHash || !normaliseComplimentaryCode(registration.code)) {
    throw new ComplimentaryRegistrationError("CODE_UNAVAILABLE");
  }

  return runSerializableTransaction(database, async (tx) => {
    const [existingUser, accessCode] = await Promise.all([
      tx.user.findUnique({ where: { email: registration.email }, select: { id: true } }),
      tx.complimentaryAccessCode.findUnique({
        where: { codeHash },
        include: { plan: true }
      })
    ]);

    if (existingUser) throw new ComplimentaryRegistrationError("EMAIL_EXISTS", 409);
    if (
      !accessCode ||
      accessCode.status !== "ISSUED" ||
      accessCode.organisationId ||
      accessCode.revokedAt
    ) {
      throw new ComplimentaryRegistrationError("CODE_UNAVAILABLE", 409);
    }
    if (
      accessCode.recipientEmail &&
      accessCode.recipientEmail.toLowerCase() !== registration.email.toLowerCase()
    ) {
      throw new ComplimentaryRegistrationError("CODE_EMAIL_MISMATCH", 403);
    }

    const plan = accessCode.plan;
    const cataloguePlan = findPublicPlan(plan?.code, plan?.productFamily);
    if (!plan?.active || !cataloguePlan || !plan.publiclyAvailable) {
      throw new ComplimentaryRegistrationError("PLAN_UNAVAILABLE", 409);
    }

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
        slug: organisationSlug(registration.organisationName, suffixFactory())
      }
    });
    await tx.organisationMember.create({
      data: { userId: user.id, organisationId: organisation.id, role: "OWNER" }
    });

    if (plan.productFamily === "ORGANISATIONS") {
      await tx.organisationMediaProfile.create({
        data: {
          organisationId: organisation.id,
          template: organisationTemplate(registration.organisationTemplate)
        }
      });
    }

    const subscription = await tx.subscription.create({
      data: {
        organisationId: organisation.id,
        planId: plan.id,
        status: "SUSPENDED",
        currentPeriodEnd: null,
        complimentaryAccessCodeId: accessCode.id,
        complimentaryAccessActive: true,
        complimentaryAccessActivatedAt: now,
        ...complimentaryPlanSnapshot(plan)
      }
    });

    const claimed = await tx.complimentaryAccessCode.updateMany({
      where: { id: accessCode.id, status: "ISSUED", organisationId: null, revokedAt: null },
      data: {
        organisationId: organisation.id,
        status: "ACTIVE",
        redeemedByUserId: user.id,
        redeemedAt: now
      }
    });
    if (claimed.count !== 1) throw new ComplimentaryRegistrationError("CODE_UNAVAILABLE", 409);

    await tx.auditLog.create({
      data: {
        organisationId: organisation.id,
        actorUserId: user.id,
        action: "COMPLIMENTARY_ACCOUNT_REGISTERED",
        entityType: "ComplimentaryAccessCode",
        entityId: accessCode.id,
        details: {
          productFamily: plan.productFamily,
          planCode: plan.code,
          codeSuffix: accessCode.codeSuffix,
          billingEventCreated: false,
          automaticExpiry: false
        }
      }
    });

    return {
      user,
      organisation,
      subscription,
      plan: {
        id: plan.id,
        code: plan.code,
        publicSlug: cataloguePlan.publicSlug,
        name: plan.name,
        productFamily: plan.productFamily,
        tierNumber: plan.tierNumber
      },
      recommendedDashboardRoute: registrationLandingRoute(plan.productFamily)
    };
  });
}
