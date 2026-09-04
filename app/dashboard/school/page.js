import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { buildSchoolProductOnboarding } from "@/lib/product-onboarding.mjs";
import { prisma } from "@/lib/prisma";
import ProductDashboard from "../ProductDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "School Radio dashboard | Ruvanas" };

export default async function SchoolProductDashboard() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { select: { id: true, status: true } }
  });
  if (!context?.membership) redirect("/dashboard");
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.schoolRadioEnabled) redirect("/dashboard/account");
  const now = new Date();
  const [episodes, reviewQueue, liveStreams, readiness, schoolProfile, activeSupervisors, activeProgrammes, approvedEpisodes] = await Promise.all([
    prisma.schoolEpisode.count({ where: { organisationId: organisation.id } }),
    prisma.schoolEpisode.count({ where: { organisationId: organisation.id, status: "IN_REVIEW" } }),
    prisma.playerListenerLease.count({ where: { organisationId: organisation.id, revokedAt: null, expiresAt: { gt: now } } }),
    prisma.schoolSafeguardingReadiness.findUnique({ where: { organisationId: organisation.id }, select: { status: true } }),
    prisma.schoolProfile.findUnique({ where: { organisationId: organisation.id }, select: { id: true } }),
    prisma.staffSupervisor.count({ where: { organisationId: organisation.id, active: true } }),
    prisma.schoolProgramme.count({ where: { organisationId: organisation.id, status: "ACTIVE" } }),
    prisma.schoolEpisode.count({ where: { organisationId: organisation.id, status: "APPROVED" } })
  ]);
  const readinessLabel = readiness?.status ? readiness.status.replaceAll("_", " ").toLowerCase() : "not started";
  const onboarding = buildSchoolProductOnboarding({
    serviceEnabled: entitlements.serviceEnabled,
    membershipRole: context.membership.role,
    schoolProfileReady: Boolean(schoolProfile),
    activeSupervisorCount: activeSupervisors,
    safeguardingStatus: readiness?.status || null,
    activeProgrammeCount: activeProgrammes,
    approvedEpisodeCount: approvedEpisodes,
    activePlayerStreams: liveStreams
  });

  return <ProductDashboard
    eyebrow="School Radio dashboard"
    title="Create, learn and broadcast safely"
    description="Bring staff and students into one supervised workspace for programmes, podcasts, news, learning and controlled publishing."
    status={readiness?.status === "APPROVED" ? "Safeguarding ready" : "Safeguarding review needed"}
    statusTone={readiness?.status === "APPROVED" ? "healthy" : "attention"}
    complimentary={entitlements.complimentaryAccess}
    onboarding={onboarding}
    primaryAction={{ href: "/dashboard/school-radio", label: "Open School Radio" }}
    metrics={[
      { label: "Episodes", value: episodes, detail: "School productions created" },
      { label: "Awaiting review", value: reviewQueue, detail: "Staff action required" },
      { label: "Safeguarding", value: readinessLabel, detail: "Controlled readiness status" },
      { label: "Live sessions", value: liveStreams, detail: "Current secure player sessions" }
    ]}
    sections={[
      { eyebrow: "Production", title: "School creative suite", description: "Create programmes with staff oversight at every important step.", actions: [
        { href: "/dashboard/school-radio", label: "School Radio workspace", description: "Open shows, episodes, podcasts, news and the live studio." },
        { href: "/dashboard/media", label: "School media library", description: "Organise approved organisation audio." },
        { href: "/dashboard/studio", label: "Professional production", description: "Request support from Ruvanas Studio." }
      ] },
      { eyebrow: "Safety", title: "Review and safeguarding", description: "Keep student participation supervised, private and accountable.", actions: [
        { href: "/dashboard/school-radio", label: "Moderation and consent", description: "Review submissions, permissions and publishing controls." },
        { href: "/dashboard/team", label: "Staff and roles", description: "Check the people authorised for this organisation." },
        { href: "/dashboard/notifications", label: "Review notifications", description: "See safeguarding and approval tasks needing attention." }
      ] },
      { eyebrow: "Guidance", title: "Operate with confidence", description: "Use help, reporting and direct support when you need it.", actions: [
        { href: "/dashboard/reports", label: "School delivery reports", description: "Review controlled publication and playback evidence." },
        { href: "/dashboard/help", label: "Help centre", description: "Follow clear School Radio guidance." },
        { href: "/dashboard/support", label: "Contact Ruvanas", description: "Create and track a support request." }
      ] }
    ]}
  />;
}
