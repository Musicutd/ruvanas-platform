import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

const schema = z.object({ enabled: z.boolean().nullable() });

export async function PATCH(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can change Retail Media access." }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose whether Retail Media is enabled for this organisation." }, { status: 400 });
    const { organisationId } = await params;
    const organisation = await prisma.organisation.findUnique({ where: { id: String(organisationId || "") }, include: { subscription: { include: { plan: true } } } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    if (!organisation.subscription) return NextResponse.json({ error: "Add a subscription before enabling Retail Media." }, { status: 409 });
    const previousOverride = organisation.subscription.retailMediaEnabled;
    const previousEffective = Boolean(previousOverride ?? organisation.subscription.plan.retailMediaEnabled);
    const nextOverride = parsed.data.enabled;
    const nextEffective = Boolean(nextOverride ?? organisation.subscription.plan.retailMediaEnabled);
    const subscription = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({ where: { id: organisation.subscription.id }, data: { retailMediaEnabled: nextOverride } });
      await tx.auditLog.create({ data: {
        organisationId: organisation.id,
        actorUserId: access.user.id,
        action: nextOverride == null ? "RETAIL_MEDIA_ENTITLEMENT_RESET" : nextEffective ? "RETAIL_MEDIA_ENTITLEMENT_ENABLED" : "RETAIL_MEDIA_ENTITLEMENT_DISABLED",
        entityType: "Subscription",
        entityId: organisation.subscription.id,
        details: { planId: organisation.subscription.planId, planDefault: organisation.subscription.plan.retailMediaEnabled, previousOverride, nextOverride, previousEffective, nextEffective }
      } });
      return updated;
    });
    return NextResponse.json({ ok: true, organisation: { id: organisation.id, name: organisation.name }, subscription: { id: subscription.id, retailMediaEnabled: subscription.retailMediaEnabled, effectiveRetailMediaEnabled: nextEffective } });
  } catch (error) {
    console.error("Update Retail Media entitlement error:", error);
    return NextResponse.json({ error: "Unable to update Retail Media access." }, { status: 500 });
  }
}
