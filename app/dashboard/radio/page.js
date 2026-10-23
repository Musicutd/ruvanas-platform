import { buildOnlineRadioProductOnboarding } from "@/lib/product-onboarding.mjs";
import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import { firstListenableOnlineStation, onlineRadioListenHref } from "@/lib/online-radio-listen.mjs";
import ProductDashboard from "../ProductDashboard";
import { resolveTestRadioSubscriberWorkspace } from "@/lib/test-radio-subscriber-access.mjs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Online Radio dashboard | Ruvanas" };

export default async function OnlineRadioDashboard() {
  const { context, entitlements } = await requireSubscriberProduct("ONLINE", {
    enterpriseSecurityPolicy: true,
    stations: { where: { productFamily: "ONLINE" }, select: { id: true, slug: true, status: true, productFamily: true, storageUsedMb: true, publicPlayerEnabled: true, stationWebsiteEnabled: true, streamConfig: { select: { streamUrl: true } } }, orderBy: { createdAt: "asc" } }
  });
  const organisation = context.membership.organisation;
  const firstStation = organisation.stations.find((station) => station.status === "ACTIVE") || organisation.stations[0] || null;
  const testRadioWorkspace = await resolveTestRadioSubscriberWorkspace(prisma, context);
  if (testRadioWorkspace) return <ProductDashboard
    eyebrow="ONLINE RADIO · TEST RADIO"
    title="Your music. Your playlists. Your week."
    description="Browse your existing catalogue, generate a playlist, build a template or load a saved mix. Arrange your programmes in the weekly planner and save a draft for administrator review. Your edits do not change the current broadcast."
    status="Planning enabled · on-air approval stays admin-only" statusTone="healthy"
    primaryAction={{ href: "/dashboard/programming?product=ONLINE#workspace-library", label: "Open music & planner" }}
    quickTasks={[
      { href: "/dashboard/programming?product=ONLINE#workspace-library", label: "1 · Music library", description: "Search the existing rights-approved catalogue and track details." },
      { href: "/dashboard/programming?product=ONLINE#workspace-simple", label: "2 · Playlists", description: "Generate Playlist, Template Builder and Load Playlist." },
      { href: "/dashboard/programming?product=ONLINE#workspace-planner", label: "3 · Weekly planner", description: "Arrange programmes, preview the week and save a new draft." }
    ]}
    metrics={[
      { label: "Station", value: testRadioWorkspace.stationName, detail: "Your existing station and music library" },
      { label: "On-air approval", value: "Admin-only", detail: "Drafts never replace the approved broadcast automatically" },
      { label: "Streaming settings", value: "Protected", detail: "Managed separately by the administrator" }
    ]}
    sections={[{ eyebrow: "PLAN WITH CONFIDENCE", title: "Prepare here. Approve on air separately.", description: "Your saved playlists and weekly drafts are shared with the administrator for review. Music-rights checks remain in place. This workspace cannot start or stop AutoDJ, change streaming credentials, upload audio or publish a programme.", actions: [
      { href: `/stations/${testRadioWorkspace.stationId}`, label: "View Test Radio", description: "Open your station workspace." },
      { href: "/dashboard/programming?product=ONLINE#workspace-simple", label: "Prepare a playlist", description: "Save a new recipe without changing an existing on-air mix." },
      { href: "/dashboard/programming?product=ONLINE#workspace-planner", label: "Plan the week", description: "Save a new draft while the approved week stays unchanged." }
    ] }]} />;
  if (entitlements.sandboxDraftOnly) return <ProductDashboard
    eyebrow="ONLINE RADIO · PRIVATE EDITABLE TEST"
    title="Your private station test workspace"
    description={entitlements.sandboxCatalogueMetadata ? "Browse rights-filtered FOCUSED catalogue metadata for Malta, save private playlist settings and preview a weekly programme plan. Audio playback, uploads, broadcasting, public publishing and paid provisioning remain off." : "Create one private station, save draft playlist settings and preview a weekly programme plan. No broadcast, audio upload, public player or paid provisioning is enabled."}
    status={entitlements.sandboxCatalogueMetadata ? "Malta catalogue metadata · audio and broadcasting off" : "Draft-only testing · live broadcasting off"} statusTone="attention"
    primaryAction={{ href: firstStation ? `/stations/${firstStation.id}` : "/stations/new", label: firstStation ? "Open test station" : "Create test station" }}
    quickTasks={[
      { href: "/dashboard/programming?product=ONLINE#workspace-library", label: "1 · Music library", description: entitlements.sandboxCatalogueMetadata ? "Browse approved catalogue metadata for Malta. No audio playback or download." : "See what your draft-only music access includes." },
      { href: "/dashboard/programming?product=ONLINE#workspace-simple", label: "2 · Playlists", description: "Create a reusable private genre-based mix." },
      { href: "/dashboard/programming?product=ONLINE#workspace-planner", label: "3 · Weekly planner", description: "Save programmes and preview your private test week." }
    ]}
    metrics={[{ label: "Test stations", value: `${organisation.stations.length} / 1`, detail: "Private station identity only" },
      { label: "Live broadcasting", value: "Off", detail: "No stream connection or listener delivery" },
      { label: "Audio uploads", value: "Off", detail: "No audio storage is provisioned for this test mode" }]}
    sections={[{ eyebrow: "TEST SAFELY", title: "Plan without going live", description: "All saved work stays inside this isolated test organisation.", actions: [
      { href: firstStation ? `/stations/${firstStation.id}` : "/stations/new", label: firstStation ? "View test station" : "Create test station", description: "Name and describe a private pending-setup station." },
      { href: "/dashboard/programming#workspace-simple", label: "Draft playlists", description: "Save genre and playlist settings without generating or playing audio." },
      { href: firstStation ? `/dashboard/radio/schedule/${firstStation.id}` : "/stations/new", label: "Weekly planner", description: "Save draft versions and preview programme times. Publication stays blocked." }
    ] }]} />;
  const listenStation = firstListenableOnlineStation(organisation.stations);
  const now = new Date();
  const [players, liveStreams, publicListeners, activeMusicModes, activeAutoDjPolicies] = await Promise.all([
    prisma.player.count({ where: { organisationId: organisation.id, status: { not: "DISABLED" } } }),
    prisma.playerListenerLease.count({ where: { organisationId: organisation.id, revokedAt: null, expiresAt: { gt: now } } }),
    prisma.publicListenerLease.count({ where: { organisationId: organisation.id, expiresAt: { gt: now } } }),
    prisma.musicMode.count({ where: { organisationId: organisation.id, status: "ACTIVE" } }),
    prisma.autoDjPolicy.count({ where: { organisationId: organisation.id, enabled: true, state: "ACTIVE", playbackPolicy: "RUN_24_7", rightsUse: "ONLINE_RADIO", channel: { status: "ACTIVE", stationId: firstStation?.id || "" } } })
  ]);
  const storageGb = organisation.stations.reduce((total, station) => total + station.storageUsedMb, 0) / 1024;
  const onboarding = buildOnlineRadioProductOnboarding({
    serviceEnabled: entitlements.serviceEnabled,
    membershipRole: context.membership.role,
    firstStationId: firstStation?.id || null,
    stationActive: firstStation?.status === "ACTIVE",
    streamConfigured: Boolean(firstStation?.streamConfig?.streamUrl),
    activeMusicModeCount: activeMusicModes,
    activeAutoDjPolicyCount: activeAutoDjPolicies,
    publicPlayerEnabled: Boolean(firstStation?.publicPlayerEnabled),
    activePublicListeners: publicListeners
  });
  const quickTasks = [
    { href: "/dashboard/programming?product=ONLINE#workspace-library", label: "1 · Music library", description: "Find approved songs and manage your own uploaded audio." },
    { href: "/dashboard/programming?product=ONLINE#workspace-simple", label: "2 · Playlists", description: "Create reusable genre-based music mixes for your programmes." },
    { href: "/dashboard/programming?product=ONLINE#workspace-planner", label: "3 · Weekly planner", description: "Arrange your programmes, save a draft and review the week." }
  ];

  return <ProductDashboard
    eyebrow="Online Radio dashboard"
    title="Your station, ready for its audience"
    description="Manage professional online stations, continuous programming, listeners and high-quality audio delivery."
    status={organisation.stations.some((station) => station.status === "ACTIVE") ? "Station available" : "Station setup needed"}
    statusTone={organisation.stations.some((station) => station.status === "ACTIVE") ? "healthy" : "attention"}
    complimentary={entitlements.complimentaryAccess}
    onboarding={onboarding}
    primaryAction={{ href: firstStation ? `/stations/${firstStation.id}` : "/stations/new", label: firstStation ? "Open station" : "Create station" }}
    listenAction={{ href: listenStation ? onlineRadioListenHref(listenStation.id) : "/dashboard/listen/online", label: listenStation && (listenStation.status !== "ACTIVE" || !listenStation.publicPlayerEnabled) ? "Listen to test stream" : "Listen live" }}
    quickTasks={quickTasks}
    metrics={[
      { label: "Stations", value: `${organisation.stations.length} / ${entitlements.stationLimit}`, detail: "Online services configured" },
      { label: "Connected players", value: players, detail: "Secure listening endpoints" },
      { label: "Live sessions", value: `${liveStreams} / ${entitlements.streamLimit}`, detail: "Streams active now" },
      { label: "Public listeners", value: `${publicListeners} / ${entitlements.listenerLimit}`, detail: "Anonymous sessions active now" },
      { label: "Audio storage", value: `${storageGb.toFixed(2)} GB`, detail: `of ${entitlements.storageLimitGb} GB available` }
    ]}
    sections={[
      { eyebrow: "Broadcast", title: "Operate your station", description: "Manage the essentials of a continuous online radio service.", actions: [
        { href: firstStation ? `/stations/${firstStation.id}` : "/stations/new", label: firstStation ? "Station control" : "Create your first station", description: "Review your station and streaming configuration." },
        { href: firstStation ? `/stations/${firstStation.id}/public-player` : "/stations/new", label: "Public player", description: "Publish and preview your branded listener page and website embed." },
        { href: firstStation ? `/stations/${firstStation.id}/website` : "/stations/new", label: "Station website & mobile", description: firstStation?.stationWebsiteEnabled ? "Manage the public station home, installable app experience and domain." : "Publish a professional, installable public home for the station." },
        { href: "/dashboard/radio/distribution", label: "Station distribution", description: "Manage provider-neutral directory, streaming/CDN, app and voice-assistant destinations." },
        { href: "/dashboard/radio/programme-director", label: "AI Programme Director", description: "Review explainable continuity recommendations and turn approved proposals into schedule drafts." },
        { href: "/dashboard/radio/newsroom", label: "Newsroom", description: "Assign station stories, preserve source evidence and manage editorial approval." },
        { href: "/dashboard/radio/networks", label: "Station networks", description: "Create explicit, revocable relationships between independently owned stations." },
        ...(entitlements.retailMediaEnabled ? [{ href: "/dashboard/radio/advertising", label: "Radio advertising", description: "Set break limits and review commercial placement readiness and completed-play evidence." }] : []),
        { href: firstStation ? `/stations/${firstStation.id}/listener-requests` : "/stations/new", label: "Listener requests", description: "Moderate audience song requests without changing the live schedule automatically." },
        { href: "/dashboard/podcasts", label: "Podcasts", description: "Publish on-demand programmes with protected audio and an RSS feed." },
        { href: firstStation ? `/dashboard/radio/schedule/${firstStation.id}` : "/stations/new", label: "Station programme schedule", description: "Draft and preview timed programmes for this station's channel. Continuous AutoDJ separately supplies the Centova encoder." },
        { href: "/dashboard/player-sessions", label: "Live sessions", description: "Monitor current listening connections." }
      ] },
      { eyebrow: "Audio", title: "Build your sound", description: "Prepare music, imaging and promotional content.", actions: [
        { href: "/dashboard/media", label: "Media library", description: "Organise station-owned audio." },
        { href: "/dashboard/promotions", label: "Campaigns and promos", description: "Schedule approved promotional content." },
        { href: "/dashboard/studio", label: "Ruvanas Studio", description: "Request voiceovers and professional production." }
      ] },
      { eyebrow: "Audience", title: "Monitor and improve", description: "Use clear evidence to keep the service reliable.", actions: [
        { href: "/dashboard/listener-analytics", label: "Listener analytics", description: "Review privacy-safe audience sessions and listening trends." },
        { href: "/dashboard/analytics", label: "Service insights", description: "Review operational delivery and player health trends." },
        { href: "/dashboard/reports", label: "Delivery reports", description: "Review broadcast and campaign evidence." },
        { href: "/dashboard/support", label: "Ruvanas support", description: "Ask for help and follow your request." }
      ] }
    ]}
  />;
}
