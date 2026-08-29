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
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can change Digital Signage access." }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose whether Digital Signage is enabled for this organisation." }, { status: 400 });
    const { organisationId } = await params;
    const organisation = await prisma.organisation.findUnique({ where: { id: String(organisationId || "") }, include: { subscription: { include: { plan: true } } } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    if (!organisation.subscription) return NextResponse.json({ error: "Add a subscription before enabling Digital Signage." }, { status: 409 });
    const previousOverride = organisation.subscription.digitalSignageEnabled;
    const previousEffective = Boolean(previousOverride ?? organisation.subscription.plan.digitalSignageEnabled);
    const nextOverride = parsed.data.enabled;
    const nextEffective = Boolean(nextOverride ?? organisation.subscription.plan.digitalSignageEnabled);
    const subscription = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({ where: { id: organisation.subscription.id }, data: { digitalSignageEnabled: nextOverride } });
      await tx.auditLog.create({ data: {
        organisationId: organisation.id,
        actorUserId: access.user.id,
        action: nextOverride == null ? "DIGITAL_SIGNAGE_ENTITLEMENT_RESET" : nextEffective ? "DIGITAL_SIGNAGE_ENTITLEMENT_ENABLED" : "DIGITAL_SIGNAGE_ENTITLEMENT_DISABLED",
        entityType: "Subscription",
        entityId: organisation.subscription.id,
        details: { planId: organisation.subscription.planId, planDefault: organisation.subscription.plan.digitalSignageEnabled, previousOverride, nextOverride, previousEffective, nextEffective }
      } });
      return updated;
    });
    return NextResponse.json({ ok: true, organisation: { id: organisation.id, name: organisation.name }, subscription: { id: subscription.id, digitalSignageEnabled: subscription.digitalSignageEnabled, effectiveDigitalSignageEnabled: nextEffective } });
  } catch (error) {
    console.error("Update Digital Signage entitlement error:", error);
    return NextResponse.json({ error: "Unable to update Digital Signage access." }, { status: 500 });
  }
}
