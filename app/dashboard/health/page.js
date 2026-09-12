import { buildHealthProductOnboarding } from "@/lib/product-onboarding.mjs";
import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import ProductDashboard from "../ProductDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ruvanas Health dashboard" };

export default async function HealthDashboard() {
  const { context, entitlements } = await requireSubscriberProduct("HEALTH", { stations: { where: { productFamily: "HEALTH" }, select: { id: true, status: true, listenerRequestsEnabled: true } } });
  const organisation = context.membership.organisation;
  const [locations, players, policies, schedules, podcasts] = await Promise.all([
    prisma.location.count({ where: { organisationId: organisation.id, status: "ACTIVE" } }),
    prisma.player.count({ where: { organisationId: organisation.id, status: { not: "DISABLED" } } }),
    prisma.autoDjPolicy.count({ where: { organisationId: organisation.id, targetType: "HEALTH_CHANNEL", enabled: true } }),
    prisma.musicSchedule.count({ where: { organisationId: organisation.id, status: "PUBLISHED" } }),
    prisma.schoolPodcastEpisode.count({ where: { organisationId: organisation.id, status: "PUBLISHED", series: { product: "HEALTH_RADIO" } } })
  ]);
  const activeChannels = organisation.stations.filter((station) => station.status === "ACTIVE");
  const programmeReady = policies > 0 && schedules > 0;
  const onboarding = buildHealthProductOnboarding({ serviceEnabled: entitlements.serviceEnabled, membershipRole: context.membership.role, activeLocationCount: locations, stationActive: activeChannels.length > 0, programmeReady, configuredPlayerCount: players, requestModerationReady: organisation.stations.some((station) => station.listenerRequestsEnabled) });
  return <ProductDashboard eyebrow="Ruvanas Health" title="Calm, controlled audio for care environments" description="Run hospital radio, wellbeing channels, announcements and listen-again programmes with subscriber ownership and privacy-aware request handling." status={activeChannels.length ? "Health channel available" : "Channel setup needed"} statusTone={activeChannels.length ? "healthy" : "attention"} complimentary={entitlements.complimentaryAccess} onboarding={onboarding} primaryAction={{ href: "/dashboard/health/setup", label: "Set up Health channel" }} metrics={[
    { label: "Health sites", value: locations, detail: "Hospitals and care locations" }, { label: "Health channels", value: `${activeChannels.length} / ${entitlements.stationLimit}`, detail: "Subscriber-owned channels" }, { label: "Players", value: players, detail: "Secure listening endpoints" }, { label: "Listen again", value: podcasts, detail: "Published Health programmes" }
  ]} sections={[
    { eyebrow: "Sites and listening", title: "Operate care environments", description: "Manage facilities, wards and listening policies without storing clinical records.", actions: [{ href: "/dashboard/locations", label: "Sites, wards & areas", description: "Create facilities and the areas they control." }, { href: "/dashboard/health/setup", label: "Channels & privacy", description: "Create Health channels, access policy and minimal moderated song requests." }, { href: "/dashboard/players", label: "Players", description: "Enrol and monitor approved listening endpoints." }, ...(entitlements.digitalSignageEnabled ? [{ href: "/dashboard/digital-signage", label: "Digital signage", description: "Manage approved non-life-safety visual content." }] : [])] },
    { eyebrow: "Programming", title: "Schedule and create", description: "Use the shared Ruvanas engines with Health-specific rights context.", actions: [{ href: "/dashboard/programming", label: "AutoDJ & schedules", description: "Build continuous programming from eligible music." }, { href: "/dashboard/media", label: "Media library", description: "Manage organisation-owned audio independently of catalogue tiers." }, { href: "/dashboard/podcasts?product=HEALTH", label: "Health podcasts", description: "Prepare reviewed on-demand programmes." }, { href: "/dashboard/studio", label: "Ruvanas Studio", description: "Produce announcements and podcasts." }] },
    { eyebrow: "Evidence", title: "Review operations", description: "See delivery and service evidence without patient profiling.", actions: [{ href: "/dashboard/analytics", label: "Service insights", description: "Review privacy-safe operational trends." }, { href: "/dashboard/reports", label: "Delivery reports", description: "Review proof of scheduled delivery." }, { href: "/dashboard/support", label: "Support", description: "Ask Ruvanas for operational help." }] }
  ]} />;
}
