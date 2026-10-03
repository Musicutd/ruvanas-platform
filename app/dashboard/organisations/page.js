import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import { pillarListenHref } from "@/lib/pillar-audio.mjs";
import ProductDashboard from "../ProductDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ruvanas Organisations dashboard" };

export default async function OrganisationsDashboard() {
  const { context, entitlements } = await requireSubscriberProduct("ORGANISATIONS", { stations: { where: { productFamily: "ORGANISATIONS", channels: { none: { musicRightsUse: "CORRECTIONS_RADIO" } } }, select: { id: true, status: true } }, organisationMediaProfile: true });
  const organisation = context.membership.organisation;
  // Historical general announcements/events can still have private Inside
  // targets. Until those JSON targets can be counted safely in the database,
  // do not display a potentially misleading or private mixed-product total.
  const [privateFacility, historicFacilityAudit, privateStation, privateChannel, privatePolicy] = await Promise.all([
    prisma.correctionsFacility.findFirst({ where: { location: { organisationId: organisation.id } }, select: { locationId: true } }),
    prisma.auditLog.findFirst({ where: { organisationId: organisation.id, action: "CORRECTIONS_FACILITY_CREATED", entityType: "Location" }, select: { id: true } }),
    prisma.station.findFirst({ where: { organisationId: organisation.id, productFamily: "CORRECTIONS" }, select: { id: true } }),
    prisma.channel.findFirst({ where: { organisationId: organisation.id, musicRightsUse: "CORRECTIONS_RADIO" }, select: { id: true } }),
    prisma.autoDjPolicy.findFirst({ where: { organisationId: organisation.id, rightsUse: "CORRECTIONS_RADIO" }, select: { id: true } })
  ]);
  const hasPrivateInsideResources = Boolean(privateFacility || historicFacilityAudit || privateStation || privateChannel || privatePolicy);
  const [locationCount, announcements, liveEvents, sponsors, podcasts] = await Promise.all([
    historicFacilityAudit
      ? prisma.$queryRaw`SELECT COUNT(*)::int AS "count" FROM "Location" l
          WHERE l."organisationId" = ${organisation.id} AND l."status" = 'ACTIVE'
            AND NOT EXISTS (SELECT 1 FROM "CorrectionsFacility" f WHERE f."locationId" = l."id")
            AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."organisationId" = ${organisation.id}
              AND a."action" = 'CORRECTIONS_FACILITY_CREATED' AND a."entityType" = 'Location' AND a."entityId" = l."id")`
      : prisma.location.count({ where: { organisationId: organisation.id, status: "ACTIVE", correctionsFacility: { is: null } } }),
    hasPrivateInsideResources ? null : prisma.organisationAnnouncement.count({ where: { organisationId: organisation.id, status: "PUBLISHED" } }),
    hasPrivateInsideResources ? null : prisma.organisationEvent.count({ where: { organisationId: organisation.id, status: "LIVE" } }),
    prisma.organisationSponsorProfile.count({ where: { organisationId: organisation.id, status: "ACTIVE" } }),
    prisma.schoolPodcastEpisode.count({ where: { organisationId: organisation.id, status: "PUBLISHED", series: { product: "ORGANISATIONS_RADIO" } } })
  ]);
  const locations = Array.isArray(locationCount) ? Number(locationCount[0]?.count || 0) : locationCount;
  const activeChannels = organisation.stations.filter((station) => station.status === "ACTIVE");
  return <ProductDashboard eyebrow="Ruvanas Organisations" title="Your organisation’s media, under your control" description="Operate channels, announcements, events, podcasts, sponsors and displays. Ruvanas supplies the technology; your organisation controls the service and content." status={activeChannels.length ? "Organisation media ready" : "Channel setup needed"} statusTone={activeChannels.length ? "healthy" : "attention"} complimentary={entitlements.complimentaryAccess} primaryAction={{ href: "/dashboard/organisations/workspace", label: "Open Organisations workspace" }} listenAction={{ href: pillarListenHref("ORGANISATIONS"), label: "Listen live" }} quickTasks={[
    { href: "/dashboard/organisations/workspace?tab=announcements", label: "Prepare an announcement", description: "Choose the message, review it and select where it appears." },
    { href: "/dashboard/organisations/workspace?tab=events", label: "Prepare an event", description: "Plan a live window with a safe fallback." },
    { href: "/dashboard/autodj/organisations", label: "Organisation AutoDJ", description: "Keep approved audio ready between events and announcements." },
    { href: "/dashboard/organisations/setup", label: "Review your channels", description: "Check audience and access settings before publishing." }
  ]} metrics={[
    { label: "Branches & venues", value: locations, detail: "Subscriber-owned locations" },
    { label: "Channels", value: `${activeChannels.length} / ${entitlements.stationLimit}`, detail: "Organisation channels" },
    { label: "Published announcements", value: announcements ?? "—", detail: hasPrivateInsideResources ? "Count hidden while private Inside resources exist" : "Explicitly selected surfaces" },
    { label: "Live events", value: liveEvents ?? "—", detail: hasPrivateInsideResources ? "Count hidden while private Inside resources exist" : "Event Mode now active" }
  ]} sections={[
    { eyebrow: "Governed communications", title: "Plan, approve and publish", description: "Keep drafts separate from approved releases and choose every publication surface explicitly.", actions: [{ href: "/dashboard/organisations/workspace?tab=announcements", label: "Announcements", description: "Create, approve and publish to selected channels and displays." }, { href: "/dashboard/organisations/workspace?tab=events", label: "Events & live", description: "Prepare live windows with a verified AutoDJ fallback." }, { href: "/dashboard/organisations/setup", label: "Channels", description: "Create subscriber-operated channels and listening policies." }] },
    { eyebrow: "Create and programme", title: "Use the shared Ruvanas production core", description: "Work with the existing Studio, AutoDJ, podcast and library systems in an Organisations rights context.", actions: [{ href: "/dashboard/programming", label: "AutoDJ & programming", description: "Build continuous schedules and event fallback." }, { href: "/dashboard/studio", label: "Ruvanas Studio", description: "Produce approved announcements, podcasts and event audio." }, { href: "/dashboard/podcasts?product=ORGANISATIONS", label: "Podcasts", description: `${podcasts} published organisation programmes.` }, { href: "/dashboard/media", label: "Media library", description: "Manage owned and explicitly licensed content." }] },
    { eyebrow: "Reach and evidence", title: "Coordinate branches without becoming a CRM", description: "Manage media delivery, sponsor disclosure and operational evidence only.", actions: [{ href: "/dashboard/organisations/workspace?tab=sponsors", label: "Sponsors & campaigns", description: `${sponsors} active sponsor profiles; proof reports delivery, not impressions.` }, { href: "/dashboard/locations", label: "Branches & venues", description: "Shared locations and zones with plan-gated delegation." }, ...(entitlements.digitalSignageEnabled ? [{ href: "/dashboard/digital-signage", label: "Digital displays", description: "Publish approved visuals to enrolled displays." }] : []), { href: "/dashboard/analytics", label: "Analytics & evidence", description: "Review privacy-safe operational evidence." }] }
  ]} />;
}
