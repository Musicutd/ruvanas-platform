import { buildRetailProductOnboarding } from "@/lib/product-onboarding.mjs";
import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import ProductDashboard from "../ProductDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retail Radio dashboard | Ruvanas" };

export default async function RetailRadioDashboard() {
  const { context, entitlements } = await requireSubscriberProduct("RETAIL");
  const organisationId = context.membership.organisationId;
  const now = new Date();
  const [locations, players, liveStreams, activeMusicModes, schedules, activeAutoDjPolicies] = await Promise.all([
    prisma.location.count({ where: { organisationId, status: "ACTIVE" } }),
    prisma.player.count({ where: { organisationId, status: { not: "DISABLED" } } }),
    prisma.playerListenerLease.count({ where: { organisationId, revokedAt: null, expiresAt: { gt: now } } }),
    prisma.musicMode.count({ where: { organisationId, status: "ACTIVE" } }),
    prisma.musicSchedule.count({ where: { organisationId, status: "PUBLISHED" } }),
    prisma.autoDjPolicy.count({ where: { organisationId, enabled: true, state: "ACTIVE", rightsUse: "RETAIL_RADIO" } })
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
    activeAutoDjPolicyCount: activeAutoDjPolicies,
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
    primaryAction={{ href: "/dashboard/retail/music", label: "Choose shop music" }}
    quickTasks={[
      { href: "/dashboard/retail/music", label: "Choose music for a shop", description: "Pick a listening area, approved music and playback hours." },
      { href: "/dashboard/promotions", label: "Prepare a promotion", description: "Create and review customer-facing audio before it goes live." },
      { href: "/dashboard/players", label: "Check shop players", description: "See which listening devices are ready and which need attention." },
      ...(entitlements.digitalSignageEnabled ? [{ href: "/dashboard/digital-signage", label: "Update a display", description: "Connect a screen or review a visual playlist before publishing." }] : [])
    ]}
    metrics={[
      { label: "Active locations", value: locations, detail: "Retail spaces ready for service" },
      { label: "Players", value: `${players} / ${entitlements.streamLimit}`, detail: "Secure devices configured" },
      { label: "Live now", value: `${liveStreams} / ${entitlements.streamLimit}`, detail: "Current stream allowance" },
      { label: "Published schedules", value: schedules, detail: "Weekly programmes available" }
    ]}
    sections={[
      { eyebrow: "Daily control", title: "Run your locations", description: "The tools used most often by retail teams.", actions: [
        { href: "/dashboard/locations", label: "Locations & Zones", description: "Create shops and the playback or display areas inside them." },
        { href: "/dashboard/retail/music", label: "Music for shops", description: "Choose approved music and keep it playing automatically." },
        { href: "/dashboard/programming", label: "Advanced programming", description: "Build detailed schedules and AutoDJ rules when you need them." },
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
