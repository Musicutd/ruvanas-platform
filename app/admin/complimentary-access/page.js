import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import { complimentaryPlanProducts, describePlanFeatures } from "@/lib/complimentary-access.mjs";
import ComplimentaryAccessAdmin from "./ComplimentaryAccessAdmin";

export const dynamic = "force-dynamic";

export default async function ComplimentaryAccessPage() {
  const adminUser = await getAdminUser();
  if (adminUser?.role !== "SUPER_ADMIN") redirect("/admin/organisations");

  const [plans, organisations, accessCodes] = await Promise.all([
    prisma.plan.findMany({ where: { active: true }, orderBy: [{ monthlyPriceCents: "asc" }, { name: "asc" }] }),
    prisma.organisation.findMany({ where: { subscription: { isNot: null } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.complimentaryAccessCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        organisation: { select: { name: true } },
        plan: { select: { name: true, code: true } },
        createdBy: { select: { name: true, email: true } },
        redeemedBy: { select: { name: true, email: true } },
        revokedBy: { select: { name: true, email: true } }
      }
    })
  ]);

  return (
    <ComplimentaryAccessAdmin
      plans={plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        code: plan.code,
        products: complimentaryPlanProducts(plan),
        features: describePlanFeatures(plan)
      }))}
      organisations={organisations}
      accessCodes={accessCodes.map((item) => ({
        id: item.id,
        organisationName: item.organisation.name,
        planName: item.plan.name,
        planCode: item.plan.code,
        codeSuffix: item.codeSuffix,
        status: item.status,
        note: item.note,
        createdAt: item.createdAt.toISOString(),
        redeemedAt: item.redeemedAt?.toISOString() || null,
        revokedAt: item.revokedAt?.toISOString() || null,
        createdBy: item.createdBy.name || item.createdBy.email,
        redeemedBy: item.redeemedBy ? item.redeemedBy.name || item.redeemedBy.email : null,
        revokedBy: item.revokedBy ? item.revokedBy.name || item.revokedBy.email : null
      }))}
    />
  );
}
