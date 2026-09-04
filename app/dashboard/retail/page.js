import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { buildRetailProductOnboarding } from "@/lib/product-onboarding.mjs";
import { prisma } from "@/lib/prisma";
import ProductDashboard from "../ProductDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retail Radio dashboard | Ruvanas" };

export default async function RetailRadioDashboard() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context?.membership) redirect("/dashboard");
  const organisationId = context.membership.organisationId;
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!entitlements.serviceEnabled) redirect("/dashboard/account");
  const now = new Date();
  const [locations, players, liveStreams, activeMusicModes, schedules] = await Promise.all([
    prisma.location.count({ where: { organisationId, status: "ACTIVE" } }),
    prisma.player.count({ where: { organisationId, status: { not: "DISABLED" } } }),
    prisma.playerListenerLease.count({ where: { organisationId, revokedAt: null, expiresAt: { gt: now } } }),
    prisma.musicMode.count({ where: { organisationId, status: "ACTIVE" } }),
    prisma.musicSchedule.count({ where: { organisationId, status: "PUBLISHED" } })
  ]);
  const optionalActions = [
    entitlements.retailMediaEnabled ? { href: "/dashboard/retail-media", label: "Retail Media", description: "Coordinate approved commercial media campaigns." } : null,
    entitlements.digitalSignageEnabled ? { href: "/dashboard/digital-signage", label: "Digital Signage", description: "Connect approved visual content with your customer spaces." } : null
  ].filter(Boolean);
  const onboarding = buildRetailProductOnboarding({
    serviceEnabled: entitlements.serviceEnabled,
    membershipRole: context.membership.role,
    activeLocationCount: locations,
    activeMusicModeCount: activeMusicModes,
    publishedScheduleCount: schedules,
    configuredPlayerCount: players,
    activePlayerStreams: liveStreams
  });

  return <ProductDashboard
    eyebrow="Retail Radio dashboard"
    title="Your shops, sounding consistent"
    description="Control music, promotions and secure players across every retail location from one focused workspace."
    status={liveStreams > 0 ? "Playing in your locations" : "Ready for a player"}
    statusTone={liveStreams > 0 ? "healthy" : "attention"}
    complimentary={entitlements.complimentaryAccess}
    onboarding={onboarding}
    primaryAction={{ href: "/dashboard/programming", label: "Open programming" }}
    metrics={[
      { label: "Active locations", value: locations, detail: "Retail spaces ready for service" },
      { label: "Players", value: `${players} / ${entitlements.streamLimit}`, detail: "Secure devices configured" },
      { label: "Live now", value: `${liveStreams} / ${entitlements.streamLimit}`, detail: "Current stream allowance" },
      { label: "Published schedules", value: schedules, detail: "Weekly programmes available" }
    ]}
    sections={[
      { eyebrow: "Daily control", title: "Run your locations", description: "The tools used most often by retail teams.", actions: [
        { href: "/dashboard/programming", label: "Music programming", description: "Choose modes and schedule the week." },
        { href: "/dashboard/players", label: "Shop players", description: "Set up and check each listening device." },
        { href: "/dashboard/player-sessions", label: "Live stream sessions", description: "See which stream slots are active now." }
      ] },
      { eyebrow: "Brand experience", title: "Content and campaigns", description: "Keep customer-facing audio organised and approved.", actions: [
        { href: "/dashboard/promotions", label: "Promotions", description: "Schedule approved promotional audio." },
        { href: "/dashboard/media", label: "Media library", description: "Manage organisation-owned audio." },
        { href: "/dashboard/studio", label: "Ruvanas Studio", description: "Request professional production support." },
        ...optionalActions
      ] },
      { eyebrow: "Evidence", title: "Performance and support", description: "Review delivery, service trends and anything needing attention.", actions: [
        { href: "/dashboard/analytics", label: "Service insights", description: "Review player and delivery trends." },
        { href: "/dashboard/reports", label: "Delivery reports", description: "Open proof-of-play and campaign results." },
        { href: "/dashboard/notifications", label: "Notification centre", description: "Act on important service updates." }
      ] }
    ]}
  />;
}
