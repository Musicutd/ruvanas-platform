import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { buildOnlineRadioProductOnboarding } from "@/lib/product-onboarding.mjs";
import { prisma } from "@/lib/prisma";
import ProductDashboard from "../ProductDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Online Radio dashboard | Ruvanas" };

export default async function OnlineRadioDashboard() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { select: { id: true, status: true, storageUsedMb: true, streamConfig: { select: { streamUrl: true } } }, orderBy: { createdAt: "asc" } }
  });
  if (!context?.membership) redirect("/dashboard");
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.serviceEnabled) redirect("/dashboard/account");
  const firstStation = organisation.stations.find((station) => station.status === "ACTIVE") || organisation.stations[0] || null;
  const now = new Date();
  const [players, liveStreams, activeMusicModes, publishedSchedules] = await Promise.all([
    prisma.player.count({ where: { organisationId: organisation.id, status: { not: "DISABLED" } } }),
    prisma.playerListenerLease.count({ where: { organisationId: organisation.id, revokedAt: null, expiresAt: { gt: now } } }),
    prisma.musicMode.count({ where: { organisationId: organisation.id, status: "ACTIVE" } }),
    prisma.musicSchedule.count({ where: { organisationId: organisation.id, status: "PUBLISHED" } })
  ]);
  const storageGb = organisation.stations.reduce((total, station) => total + station.storageUsedMb, 0) / 1024;
  const onboarding = buildOnlineRadioProductOnboarding({
    serviceEnabled: entitlements.serviceEnabled,
    membershipRole: context.membership.role,
    firstStationId: firstStation?.id || null,
    stationActive: firstStation?.status === "ACTIVE",
    streamConfigured: Boolean(firstStation?.streamConfig?.streamUrl),
    activeMusicModeCount: activeMusicModes,
    publishedScheduleCount: publishedSchedules,
    activePlayerStreams: liveStreams
  });

  return <ProductDashboard
    eyebrow="Online Radio dashboard"
    title="Your station, ready for its audience"
    description="Manage professional online stations, continuous programming, listeners and high-quality audio delivery."
    status={organisation.stations.some((station) => station.status === "ACTIVE") ? "Station available" : "Station setup needed"}
    statusTone={organisation.stations.some((station) => station.status === "ACTIVE") ? "healthy" : "attention"}
    complimentary={entitlements.complimentaryAccess}
    onboarding={onboarding}
    primaryAction={{ href: firstStation ? `/stations/${firstStation.id}` : "/stations/new", label: firstStation ? "Open station" : "Create station" }}
    metrics={[
      { label: "Stations", value: `${organisation.stations.length} / ${entitlements.stationLimit}`, detail: "Online services configured" },
      { label: "Connected players", value: players, detail: "Secure listening endpoints" },
      { label: "Live sessions", value: `${liveStreams} / ${entitlements.streamLimit}`, detail: "Streams active now" },
      { label: "Audio storage", value: `${storageGb.toFixed(2)} GB`, detail: `of ${entitlements.storageLimitGb} GB available` }
    ]}
    sections={[
      { eyebrow: "Broadcast", title: "Operate your station", description: "Manage the essentials of a continuous online radio service.", actions: [
        { href: firstStation ? `/stations/${firstStation.id}` : "/stations/new", label: firstStation ? "Station control" : "Create your first station", description: "Review your station and streaming configuration." },
        { href: "/dashboard/programming", label: "Programme schedule", description: "Plan music and dayparts." },
        { href: "/dashboard/player-sessions", label: "Live sessions", description: "Monitor current listening connections." }
      ] },
      { eyebrow: "Audio", title: "Build your sound", description: "Prepare music, imaging and promotional content.", actions: [
        { href: "/dashboard/media", label: "Media library", description: "Organise station-owned audio." },
        { href: "/dashboard/promotions", label: "Campaigns and promos", description: "Schedule approved promotional content." },
        { href: "/dashboard/studio", label: "Ruvanas Studio", description: "Request voiceovers and professional production." }
      ] },
      { eyebrow: "Audience", title: "Monitor and improve", description: "Use clear evidence to keep the service reliable.", actions: [
        { href: "/dashboard/analytics", label: "Service insights", description: "Review operational and audience trends." },
        { href: "/dashboard/reports", label: "Delivery reports", description: "Review broadcast and campaign evidence." },
        { href: "/dashboard/support", label: "Ruvanas support", description: "Ask for help and follow your request." }
      ] }
    ]}
  />;
}
