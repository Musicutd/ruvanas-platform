import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import {
  PRODUCT_QA_PROFILES,
  evaluateProductQaPlan,
  productQaTierMatrix
} from "@/lib/product-qa-acceptance.mjs";
import ProductQaControlCentre from "./ProductQaControlCentre";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product QA | Ruvanas Administration" };

export default async function ProductQaPage() {
  const adminUser = await getAdminUser();
  if (adminUser?.role !== "SUPER_ADMIN") redirect("/admin/organisations");

  const organisations = await prisma.organisation.findMany({
    where: { name: { in: PRODUCT_QA_PROFILES.map((profile) => profile.organisationName) } },
    include: {
      subscription: {
        include: { plan: true, billingContract: true }
      },
      members: { select: { user: { select: { email: true } } }, take: 2 }
    },
    orderBy: { name: "asc" }
  });
  const byName = new Map(organisations.map((organisation) => [organisation.name, organisation]));
  const matrix = productQaTierMatrix();

  const profiles = PRODUCT_QA_PROFILES.map((profile) => {
    const organisation = byName.get(profile.organisationName) || null;
    const evaluation = organisation?.subscription?.plan
      ? evaluateProductQaPlan(organisation.subscription.plan, profile)
      : null;
    return {
      ...profile,
      organisation: organisation ? {
        id: organisation.id,
        name: organisation.name,
        ownerConfigured: organisation.members.length > 0,
        subscriptionStatus: organisation.subscription?.status || null,
        billingAttached: Boolean(organisation.subscription?.billingContract),
        complimentaryAccessActive: Boolean(organisation.subscription?.complimentaryAccessActive),
        plan: organisation.subscription?.plan ? {
          code: organisation.subscription.plan.code,
          name: organisation.subscription.plan.name,
          tierNumber: organisation.subscription.plan.tierNumber
        } : null,
        acceptancePassed: evaluation?.passed === true
      } : null,
      tiers: matrix.filter((item) => item.product === profile.product)
    };
  });

  return <ProductQaControlCentre initialProfiles={profiles} />;
}
