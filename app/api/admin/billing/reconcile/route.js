import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { reconcileOrganisationBillingUsage } from "@/lib/billing-service";

const usageSchema = z.object({
  locationCount: z.coerce.number().int().nonnegative(),
  zoneCount: z.coerce.number().int().nonnegative(),
  stationCount: z.coerce.number().int().nonnegative(),
  storageBytes: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
  schoolRadioEnabled: z.boolean()
});

const schema = z.object({
  organisationId: z.string().min(1),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  providerUsage: usageSchema.optional()
}).refine((value) => value.periodEnd > value.periodStart, {
  message: "The period end must be after its start."
});

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only a Ruvanas Super Admin can reconcile billing usage." },
        { status: 403 }
      );
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid reconciliation details." },
        { status: 400 }
      );
    }

    const result = await reconcileOrganisationBillingUsage({
      ...parsed.data,
      actorUserId: access.user.id
    });
    return NextResponse.json({
      ok: true,
      reconciliation: {
        id: result.reconciliation.id,
        status: result.reconciliation.status,
        snapshot: result.snapshot,
        discrepancies: result.comparison.discrepancies
      }
    });
  } catch (error) {
    if (error.message === "ORGANISATION_NOT_FOUND") {
      return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    }
    if (error.message === "SUBSCRIPTION_REQUIRED") {
      return NextResponse.json(
        { error: "This organisation does not have a subscription." },
        { status: 409 }
      );
    }
    console.error("Billing reconciliation error:", error);
    return NextResponse.json(
      { error: "Unable to reconcile billing usage." },
      { status: 500 }
    );
  }
}

