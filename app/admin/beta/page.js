import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { betaOperationsSummary } from "@/lib/beta-operations.mjs";
import { buildBetaPortfolioInsights, buildBetaProgrammeInsights } from "@/lib/beta-insights.mjs";
import BetaOperationsCentre from "./BetaOperationsCentre";

export const dynamic = "force-dynamic";
export const metadata = { title: "Beta operations | Ruvanas Administration" };

function serializable(value) {
  return JSON.parse(JSON.stringify(value));
}

export default async function BetaOperationsPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/login");

  const [programmes, organisations] = await Promise.all([
    prisma.betaProgramme.findMany({
      include: {
        createdBy: { select: { name: true, email: true } },
        participants: {
          include: {
            organisation: { select: { name: true } },
            admittedBy: { select: { name: true, email: true } }
          },
          orderBy: { admittedAt: "desc" }
        },
        feedback: {
          include: {
            organisation: { select: { name: true } },
            createdBy: { select: { name: true, email: true } },
            triagedBy: { select: { name: true, email: true } }
          },
          orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "desc" }]
        },
        reviews: {
          include: { reviewedBy: { select: { name: true, email: true } } },
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.organisation.findMany({
      include: { subscription: { include: { plan: true, billingContract: true } } },
      orderBy: { name: "asc" }
    })
  ]);

  const organisationOptions = organisations.map((organisation) => ({
    id: organisation.id,
    name: organisation.name,
    entitlements: resolveEntitlements(organisation.subscription),
    planName: organisation.subscription?.plan?.name || "No plan"
  }));
  const programmesWithInsights = programmes.map((programme) => ({
    ...programme,
    insights: buildBetaProgrammeInsights(programme)
  }));

  return (
    <BetaOperationsCentre
      role={adminUser.role}
      initialProgrammes={serializable(programmesWithInsights)}
      organisations={serializable(organisationOptions)}
      summary={betaOperationsSummary(programmes)}
      portfolio={buildBetaPortfolioInsights(programmes)}
    />
  );
}
