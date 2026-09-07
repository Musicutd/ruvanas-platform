import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  evaluateProductQaPlan,
  productQaSubscriptionUpdate,
  productQaSwitchDecision
} from "@/lib/product-qa-acceptance.mjs";

export const dynamic = "force-dynamic";

const schema = z.object({
  organisationId: z.string().trim().min(1).max(191),
  planCode: z.string().trim().min(1).max(80)
}).strict();

export async function PATCH(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only a Ruvanas Super Admin can operate product QA tiers." },
        { status: 403 }
      );
    }

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Choose a designated QA organisation and one of its five product tiers." },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.findUnique({
        where: { id: parsed.data.organisationId },
        include: {
          subscription: {
            include: { plan: true, billingContract: true }
          }
        }
      });
      if (!organisation) return { error: "QA organisation not found.", status: 404 };

      const decision = productQaSwitchDecision({
        organisation,
        planCode: parsed.data.planCode
      });
      if (!decision.ok) return { error: decision.error, status: decision.status };

      const targetPlan = await tx.plan.findFirst({
        where: {
          code: decision.cataloguePlan.code,
          productFamily: decision.profile.product,
          active: true,
          publiclyAvailable: true
        }
      });
      if (!targetPlan) {
        return { error: "The selected QA tier is not currently available.", status: 409 };
      }

      const previousPlan = organisation.subscription.plan;
      const updated = await tx.subscription.update({
        where: { id: organisation.subscription.id },
        data: productQaSubscriptionUpdate(targetPlan.id),
        include: { plan: true, billingContract: true }
      });
      const evaluation = evaluateProductQaPlan(updated.plan, decision.profile);
      if (!evaluation.passed) throw new Error(`QA entitlement verification failed: ${evaluation.failures.join(", ")}`);

      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: access.user.id,
          action: "PRODUCT_QA_TIER_SWITCHED",
          entityType: "Subscription",
          entityId: updated.id,
          details: {
            qaProduct: decision.profile.product,
            previousPlanCode: previousPlan.code,
            nextPlanCode: updated.plan.code,
            previousTier: previousPlan.tierNumber,
            nextTier: updated.plan.tierNumber,
            landingRoute: evaluation.route,
            licensedMusicCatalogueLevel: evaluation.entitlements.licensedMusicCatalogueLevel,
            billingEventCreated: false
          }
        }
      });

      return {
        status: 200,
        body: {
          ok: true,
          organisation: { id: organisation.id, name: organisation.name },
          product: decision.profile.product,
          plan: {
            id: updated.plan.id,
            code: updated.plan.code,
            name: updated.plan.name,
            tierNumber: updated.plan.tierNumber
          },
          acceptance: {
            passed: evaluation.passed,
            landingRoute: evaluation.route,
            licensedMusicCatalogueLevel: evaluation.entitlements.licensedMusicCatalogueLevel,
            stationLimit: evaluation.entitlements.stationLimit,
            listenerLimit: evaluation.entitlements.listenerLimit,
            storageLimitGb: evaluation.entitlements.storageLimitGb,
            maxBitrateKbps: evaluation.entitlements.maxBitrateKbps
          }
        }
      };
    });

    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Product QA tier switch error:", error);
    return NextResponse.json(
      { error: "Unable to switch the controlled QA tier." },
      { status: 500 }
    );
  }
}
