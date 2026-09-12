import { buildFaithProductOnboarding } from "@/lib/product-onboarding.mjs";
import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import ProductDashboard from "../ProductDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ruvanas Faith dashboard" };

export default async function FaithDashboard() {
  const { context, entitlements } = await requireSubscriberProduct("FAITH", { stations: { where: { productFamily: "FAITH" }, select: { id: true, status: true, audiencePolicy: true, channels: { select: { id: true } } } } });
  const organisation = context.membership.organisation;
  const channelIds = organisation.stations.flatMap((station) => station.channels.map((channel) => channel.id));
  const [locations, players, policies, schedules, liveServices, teachings] = await Promise.all([
    prisma.location.count({ where: { organisationId: organisation.id, status: "ACTIVE" } }),
    prisma.player.count({ where: { organisationId: organisation.id, status: { not: "DISABLED" } } }),
    prisma.autoDjPolicy.count({ where: { organisationId: organisation.id, targetType: "FAITH_CHANNEL", enabled: true } }),
    prisma.musicSchedule.count({ where: { organisationId: organisation.id, status: "PUBLISHED" } }),
    channelIds.length ? prisma.externalLiveSource.count({ where: { organisationId: organisation.id, channelId: { in: channelIds }, status: { in: ["DRAFT", "ACTIVE"] } } }) : 0,
    prisma.schoolPodcastEpisode.count({ where: { organisationId: organisation.id, status: "PUBLISHED", series: { product: "FAITH_RADIO" } } })
  ]);
  const activeChannels = organisation.stations.filter((station) => station.status === "ACTIVE");
  const onboarding = buildFaithProductOnboarding({ serviceEnabled: entitlements.serviceEnabled, membershipRole: context.membership.role, activeLocationCount: locations, stationActive: activeChannels.length > 0, programmeReady: policies > 0 && schedules > 0, liveServiceReady: liveServices > 0, publishedPodcastCount: teachings });
  return <ProductDashboard eyebrow="Ruvanas Faith" title="Continuous radio and live services for every campus" description="Run scheduled faith radio, hand off to live services, resume AutoDJ, and publish reviewed sermons, teachings and community programmes." status={activeChannels.length ? "Faith channel available" : "Channel setup needed"} statusTone={activeChannels.length ? "healthy" : "attention"} complimentary={entitlements.complimentaryAccess} onboarding={onboarding} primaryAction={{ href: "/dashboard/faith/setup", label: "Set up Faith channel" }} metrics={[
    { label: "Campuses", value: locations, detail: "Ministry locations" }, { label: "Faith channels", value: `${activeChannels.length} / ${entitlements.stationLimit}`, detail: "Continuous or service-led" }, { label: "Players", value: players, detail: "Listening endpoints" }, { label: "Teachings", value: teachings, detail: "Published listen-again items" }
  ]} sections={[
    { eyebrow: "Campuses", title: "Operate your network", description: "Manage locations, channels and listening access without prescribing doctrine.", actions: [{ href: "/dashboard/locations", label: "Campuses & areas", description: "Create campuses, halls, foyers and community areas." }, { href: "/dashboard/faith/setup", label: "Channels & audiences", description: "Create internal, restricted or public Faith channels." }, { href: "/dashboard/players", label: "Players", description: "Enrol listening endpoints for each area." }, ...(entitlements.digitalSignageEnabled ? [{ href: "/dashboard/digital-signage", label: "Digital signage", description: "Coordinate approved visual content." }] : [])] },
    { eyebrow: "Broadcast", title: "Programme and go live", description: "Move safely between continuous audio and scheduled services.", actions: [{ href: "/dashboard/programming", label: "24/7 AutoDJ", description: "Create rights-cleared continuous programming and fallback." }, { href: "/dashboard/faith/setup", label: "Live service readiness", description: "Review the channel and access policy before scheduling live input." }, { href: "/dashboard/podcasts?product=FAITH", label: "Sermons & teachings", description: "Review and publish listen-again audio." }, { href: "/dashboard/studio", label: "Ruvanas Studio", description: "Prepare announcements, sermons and podcasts." }] },
    { eyebrow: "Teams and evidence", title: "Coordinate responsibly", description: "Use existing roles, reports and support for subscriber-controlled operations.", actions: [{ href: "/dashboard/team", label: "Teams & roles", description: "Manage authorised contributors and reviewers." }, { href: "/dashboard/reports", label: "Delivery reports", description: "Review playback and publication evidence." }, { href: "/dashboard/support", label: "Support", description: "Ask Ruvanas for operational help." }] }
  ]} />;
}
