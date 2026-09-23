import { buildRetailProductOnboarding } from "@/lib/product-onboarding.mjs";
import { loadRetailControlCentre } from "@/lib/retail-dashboard-service.mjs";
import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import RetailControlCentre from "./RetailControlCentre";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retail Control Centre | Ruvanas" };

export default async function RetailRadioDashboard() {
  const { context, entitlements } = await requireSubscriberProduct("RETAIL");
  const organisationId = context.membership.organisationId;
  const now = new Date();
  const [summary, liveStreams] = await Promise.all([
    loadRetailControlCentre(prisma, { organisationId, role: context.membership.role, entitlements, now }),
    prisma.playerListenerLease.count({ where: { organisationId, revokedAt: null, expiresAt: { gt: now } } })
  ]);
  const onboarding = buildRetailProductOnboarding({
    serviceEnabled: entitlements.serviceEnabled,
    membershipRole: context.membership.role,
    activeLocationCount: summary.counts.activeStores,
    activeMusicModeCount: summary.counts.activeMusicModes,
    publishedScheduleCount: summary.counts.publishedSchedules,
    activeAutoDjPolicyCount: summary.counts.activeAutoDjPolicies,
    configuredPlayerCount: summary.counts.players,
    activePlayerStreams: liveStreams
  });

  return <RetailControlCentre summary={summary} onboarding={onboarding} complimentary={entitlements.complimentaryAccess} />;
}
