import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import ProductDashboard from "../ProductDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ruvanas Organisations dashboard" };

export default async function OrganisationsDashboard() {
  const { context, entitlements } = await requireSubscriberProduct("ORGANISATIONS", { stations: { where: { productFamily: "ORGANISATIONS" }, select: { id: true, status: true } }, organisationMediaProfile: true });
  const organisation = context.membership.organisation;
  const [locations, announcements, liveEvents, sponsors, podcasts] = await Promise.all([
    prisma.location.count({ where: { organisationId: organisation.id, status: "ACTIVE" } }),
    prisma.organisationAnnouncement.count({ where: { organisationId: organisation.id, status: "PUBLISHED" } }),
    prisma.organisationEvent.count({ where: { organisationId: organisation.id, status: "LIVE" } }),
    prisma.organisationSponsorProfile.count({ where: { organisationId: organisation.id, status: "ACTIVE" } }),
    prisma.schoolPodcastEpisode.count({ where: { organisationId: organisation.id, status: "PUBLISHED", series: { product: "ORGANISATIONS_RADIO" } } })
  ]);
  const activeChannels = organisation.stations.filter((station) => station.status === "ACTIVE");
  return <ProductDashboard eyebrow="Ruvanas Organisations" title="Your organisation’s media, under your control" description="Operate channels, announcements, events, podcasts, sponsors and displays. Ruvanas supplies the technology; your organisation controls the service and content." status={activeChannels.length ? "Organisation media ready" : "Channel setup needed"} statusTone={activeChannels.length ? "healthy" : "attention"} complimentary={entitlements.complimentaryAccess} primaryAction={{ href: "/dashboard/organisations/workspace", label: "Open Organisations workspace" }} metrics={[
    { label: "Branches & venues", value: locations, detail: "Subscriber-owned locations" },
    { label: "Channels", value: `${activeChannels.length} / ${entitlements.stationLimit}`, detail: "Organisation channels" },
    { label: "Published announcements", value: announcements, detail: "Explicitly selected surfaces" },
    { label: "Live events", value: liveEvents, detail: "Event Mode now active" }
  ]} sections={[
    { eyebrow: "Governed communications", title: "Plan, approve and publish", description: "Keep drafts separate from approved releases and choose every publication surface explicitly.", actions: [{ href: "/dashboard/organisations/workspace?tab=announcements", label: "Announcements", description: "Create, approve and publish to selected channels and displays." }, { href: "/dashboard/organisations/workspace?tab=events", label: "Events & live", description: "Prepare live windows with a verified AutoDJ fallback." }, { href: "/dashboard/organisations/setup", label: "Channels", description: "Create subscriber-operated channels and listening policies." }] },
    { eyebrow: "Create and programme", title: "Use the shared Ruvanas production core", description: "Work with the existing Studio, AutoDJ, podcast and library systems in an Organisations rights context.", actions: [{ href: "/dashboard/programming", label: "AutoDJ & programming", description: "Build continuous schedules and event fallback." }, { href: "/dashboard/studio", label: "Ruvanas Studio", description: "Produce approved announcements, podcasts and event audio." }, { href: "/dashboard/podcasts?product=ORGANISATIONS", label: "Podcasts", description: `${podcasts} published organisation programmes.` }, { href: "/dashboard/media", label: "Media library", description: "Manage owned and explicitly licensed content." }] },
    { eyebrow: "Reach and evidence", title: "Coordinate branches without becoming a CRM", description: "Manage media delivery, sponsor disclosure and operational evidence only.", actions: [{ href: "/dashboard/organisations/workspace?tab=sponsors", label: "Sponsors & campaigns", description: `${sponsors} active sponsor profiles; proof reports delivery, not impressions.` }, { href: "/dashboard/locations", label: "Branches & venues", description: "Shared locations and zones with plan-gated delegation." }, ...(entitlements.digitalSignageEnabled ? [{ href: "/dashboard/digital-signage", label: "Digital displays", description: "Publish approved visuals to enrolled displays." }] : []), { href: "/dashboard/analytics", label: "Analytics & evidence", description: "Review privacy-safe operational evidence." }] }
  ]} />;
}
