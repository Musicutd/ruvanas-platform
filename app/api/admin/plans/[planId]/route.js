import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const PRODUCT_ACCESS_FIELDS = [
  "retailRadioEnabled",
  "schoolRadioEnabled",
  "onlineRadioEnabled",
  "healthRadioEnabled",
  "faithRadioEnabled",
  "organisationsEnabled"
];

// Stable plan code and productFamily authority are intentionally not editable.
const updateSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  name: z.string().trim().min(2).max(120),
  tierNumber: z.number().int().min(1).max(5),
  monthlyPriceCents: z.number().int().min(0).max(100_000_000),
  stationLimit: z.number().int().min(0).max(100_000),
  storageLimitGb: z.number().int().min(0).max(1_000_000),
  listenerLimit: z.number().int().min(0).max(100_000_000),
  maxBitrateKbps: z.number().int().min(32).max(1024),
  studioExternalDestinationLimit: z.number().int().min(0).max(10_000).nullable(),
  licensedMusicCatalogueLevel: z.enum(["NONE", "FOCUSED", "PROFESSIONAL", "PREMIUM"]),
  promoUploadEnabled: z.boolean(),
  retailRadioEnabled: z.boolean(),
  schoolRadioEnabled: z.boolean(),
  onlineRadioEnabled: z.boolean(),
  healthRadioEnabled: z.boolean(),
  faithRadioEnabled: z.boolean(),
  organisationsEnabled: z.boolean(),
  schoolPublicPublishingEnabled: z.boolean(),
  retailMediaEnabled: z.boolean(),
  digitalSignageEnabled: z.boolean(),
  active: z.boolean()
}).strict().superRefine((value, context) => {
  if (!PRODUCT_ACCESS_FIELDS.some((field) => value[field])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["productAccess"], message: "Keep at least one product enabled for this tier." });
  }
});

function editablePlanSnapshot(plan) {
  return {
    name: plan.name,
    tierNumber: plan.tierNumber,
    monthlyPriceCents: plan.monthlyPriceCents,
    stationLimit: plan.stationLimit,
    storageLimitGb: plan.storageLimitGb,
    listenerLimit: plan.listenerLimit,
    maxBitrateKbps: plan.maxBitrateKbps,
    studioExternalDestinationLimit: plan.studioExternalDestinationLimit,
    licensedMusicCatalogueLevel: plan.licensedMusicCatalogueLevel,
    promoUploadEnabled: plan.promoUploadEnabled,
    retailRadioEnabled: plan.retailRadioEnabled,
    schoolRadioEnabled: plan.schoolRadioEnabled,
    onlineRadioEnabled: plan.onlineRadioEnabled,
    healthRadioEnabled: plan.healthRadioEnabled,
    faithRadioEnabled: plan.faithRadioEnabled,
    organisationsEnabled: plan.organisationsEnabled,
    schoolPublicPublishingEnabled: plan.schoolPublicPublishingEnabled,
    retailMediaEnabled: plan.retailMediaEnabled,
    digitalSignageEnabled: plan.digitalSignageEnabled,
    active: plan.active
  };
}

export async function PATCH(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can edit plan tiers." }, { status: 403 });
    }
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Review the tier details and try again." }, { status: 400 });
    }
    const { planId } = await params;
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.plan.findUnique({ where: { id: planId } });
      if (!current || !current.publiclyAvailable) throw new Error("PLAN_NOT_FOUND");
      if (current.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) throw new Error("PLAN_STALE");

      const duplicateTier = await tx.plan.findFirst({
        where: {
          id: { not: current.id },
          productFamily: current.productFamily,
          tierNumber: parsed.data.tierNumber,
          publiclyAvailable: true
        },
        select: { id: true }
      });
      if (duplicateTier) throw new Error("DUPLICATE_TIER");

      const before = editablePlanSnapshot(current);
      const { expectedUpdatedAt: _expectedUpdatedAt, ...updates } = parsed.data;
      const updated = await tx.plan.update({ where: { id: current.id }, data: updates });
      await tx.auditLog.create({
        data: {
          actorUserId: access.user.id,
          action: "PLAN_TIER_UPDATED",
          entityType: "Plan",
          entityId: updated.id,
          details: {
            code: updated.code,
            productFamily: updated.productFamily,
            before,
            after: editablePlanSnapshot(updated)
          }
        }
      });
      return updated;
    });

    return NextResponse.json({ ok: true, plan: { ...result, updatedAt: result.updatedAt.toISOString(), createdAt: result.createdAt.toISOString() } });
  } catch (error) {
    console.error("Update plan tier error:", error);
    if (error?.message === "PLAN_NOT_FOUND") return NextResponse.json({ error: "This public tier no longer exists." }, { status: 404 });
    if (error?.message === "PLAN_STALE") return NextResponse.json({ error: "This tier changed in another session. Refresh before saving again." }, { status: 409 });
    if (error?.message === "DUPLICATE_TIER") return NextResponse.json({ error: "That product already has a public tier with this number." }, { status: 409 });
    if (error?.code === "P2002") return NextResponse.json({ error: "Another plan already uses that name." }, { status: 409 });
    return NextResponse.json({ error: "The tier could not be updated. No partial change was retained." }, { status: 500 });
  }
}
