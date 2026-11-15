import { buildRetailProductOnboarding } from "@/lib/product-onboarding.mjs";
import { loadRetailControlCentre } from "@/lib/retail-dashboard-service.mjs";
import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import RetailControlCentre from "./RetailControlCentre";
import RetailPlanningHome from "./RetailPlanningHome";
import { resolveRetailSubscriberWorkspace } from "@/lib/retail-subscriber-access.mjs";
import { isPrivatePreviewSubscriberTestingSession } from "@/lib/private-preview-subscriber-testing.mjs";
import { readRewardsFeaturePolicy } from "@/lib/retail-rewards/feature-policy.mjs";
import { readReportsPolicy } from "@/lib/retail-rewards/reports-contracts.mjs";
import { readCheckoutPolicy } from "@/lib/retail-rewards/checkout-contracts.mjs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retail Control Centre | Ruvanas" };

export default async function RetailRadioDashboard() {
  const { context, entitlements } = await requireSubscriberProduct("RETAIL");
  const workspace = await resolveRetailSubscriberWorkspace(prisma, context);
  if (workspace) return <RetailPlanningHome stationName={workspace.stationName} testTierEnabled={isPrivatePreviewSubscriberTestingSession(context.session)} />;
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

  let rewardsAvailable = false, reportsAvailable = false, checkoutAvailable = false;
  if (readRewardsFeaturePolicy(process.env).enabled) {
    const { authorizeRewardOffers } = await import("@/lib/retail-rewards/offer-server");
    rewardsAvailable = (await authorizeRewardOffers("READ")).ok;
  }
  if (readReportsPolicy(process.env).enabled) {
    const { authorizeRewardReports } = await import("@/lib/retail-rewards/reporting-server");
    reportsAvailable = (await authorizeRewardReports()).ok;
  }
  if (readCheckoutPolicy(process.env).enabled) {
    const { loadStaffCheckoutPage } = await import("@/lib/retail-rewards/checkout-server");
    const checkout = await loadStaffCheckoutPage();
    checkoutAvailable = checkout.ok && (checkout.locations.length > 0 || checkout.hasMore);
  }
  return <>
    {rewardsAvailable || reportsAvailable || checkoutAvailable ? <aside style={{ margin: "24px 32px 0", padding: 20, border: "1px solid #b78a2f", borderRadius: 12 }}>
      <strong>Retail Rewards</strong>
      {rewardsAvailable && <><p>Create coupons and manage your organisation’s offers.</p><a href="/dashboard/retail/rewards">Open Rewards →</a></>}
      {reportsAvailable && <p><a href="/dashboard/retail/rewards/reports">View shop coupon reports →</a></p>}
      {checkoutAvailable && <p><a href="/dashboard/retail/rewards/redeem">Open shop coupon checkout →</a></p>}
    </aside> : null}
    <RetailControlCentre summary={summary} onboarding={onboarding} complimentary={entitlements.complimentaryAccess} />
  </>;
}
