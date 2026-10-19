import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { enabledSubscriberProducts } from "@/lib/product-access.mjs";
import { prisma } from "@/lib/prisma";
import SkipLink from "@/app/components/SkipLink";
import ProgrammingWorkspace from "./ProgrammingWorkspace";
import SmartPlaylistsWorkspace from "./SmartPlaylistsWorkspace";
import RadioClocksWorkspace from "./RadioClocksWorkspace";
import AdvancedSchedulerWorkspace from "./AdvancedSchedulerWorkspace";
import ExternalLiveWorkspace from "./ExternalLiveWorkspace";
import DjAccessWorkspace from "./DjAccessWorkspace";
import LiveFailoverWorkspace from "./LiveFailoverWorkspace";
import BrowserLiveStudioWorkspace from "./BrowserLiveStudioWorkspace";
import VoiceTrackingWorkspace from "./VoiceTrackingWorkspace";
import AudioProcessingWorkspace from "./AudioProcessingWorkspace";
import AutoDjExpansionWorkspace from "./AutoDjExpansionWorkspace";
import WorkspaceTabs from "../WorkspaceTabs";
import SimplePlaylistWorkspace from "./SimplePlaylistWorkspace";
import OnlineRadioLibraryWorkspace from "./OnlineRadioLibraryWorkspace";
import styles from "./programming.module.css";

export const dynamic = "force-dynamic";

export default async function SubscriberProgrammingPage({ searchParams }) {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  const canManage = ["OWNER", "MANAGER"].includes(context.membership.role);
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  const sandboxDraftOnly = entitlements.sandboxDraftOnly;
  const onlineOnly = entitlements.onlineRadioEnabled && ![
    entitlements.retailRadioEnabled, entitlements.schoolRadioEnabled, entitlements.healthRadioEnabled,
    entitlements.faithRadioEnabled, entitlements.organisationsEnabled
  ].some(Boolean);
  const requestedOnline = (await searchParams)?.product === "ONLINE";
  const radioPlanning = entitlements.onlineRadioEnabled && (onlineOnly || sandboxDraftOnly || requestedOnline);
  const onlineChannelIds = radioPlanning ? (await prisma.channel.findMany({
    where: { organisationId: context.membership.organisationId, station: { productFamily: "ONLINE" }, OR: [{ musicRightsUse: null }, { musicRightsUse: "ONLINE_RADIO" }] },
    select: { id: true }, orderBy: { id: "asc" }, take: 200
  })).map((channel) => channel.id) : null;
  const onlineRadioStation = entitlements.onlineRadioEnabled && !radioPlanning ? await prisma.station.findFirst({
    where: { organisationId: context.membership.organisationId, productFamily: "ONLINE" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" }
  }) : null;
  const tabs = sandboxDraftOnly ? [
    { id: "library", label: "1 · Music library", description: "Understand catalogue access in this draft-only test" },
    { id: "simple", label: "2 · Playlists", description: "Save a reusable genre-based music draft" },
    { id: "planner", label: "3 · Weekly planner", description: "Place programmes in a week and preview the times" }
  ] : [
    ...(radioPlanning ? [{ id: "library", label: "1 · Music library", description: "Browse approved catalogue music or your own uploads" }] : []),
    { id: "simple", label: radioPlanning ? "2 · Playlists" : "AutoDJ & playlists", description: "Choose a channel and save a reusable music mix" },
    { id: "planner", label: radioPlanning ? "3 · Weekly planner" : "Weekly planner", description: "Save a draft and review the seven-day preview" },
    { id: "schedule", label: onlineOnly ? "Backup & playback" : "Locations & backup", description: onlineOnly ? "Detailed fallback music and playback settings" : "Location / zone plans and fallback music" },
    { id: "automation", label: "Advanced tools", description: "Music rules, clocks and generated playlists" },
    { id: "live", label: "Live radio", description: "Studio, sources and failover" },
    { id: "production", label: "Production", description: "Voice tracks and audio processing" },
    ...(canManage ? [{ id: "access", label: "DJ access", description: "Controlled presenter access" }] : [])
  ];

  return (
    <main className={styles.page}>
      <SkipLink />
      <header className={styles.header}>
        <a href="/dashboard" className={styles.brand}>RUVANAS</a>
        <a href="/dashboard" className={styles.back}>Back to dashboard</a>
      </header>
      <section className={styles.shell} id="main-content">
        <div className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{radioPlanning ? "ONLINE RADIO · MUSIC & PLANNING" : "AUTODJ & SCHEDULE"}</p>
            <h1>{radioPlanning ? "Your music. Your programmes. Your week." : "Music made easier to plan"}</h1>
            <p className={styles.intro}>
              {sandboxDraftOnly ? "Start with your music access, create a private playlist draft, then plan and preview your week. No audio, public player or broadcasting is enabled." : radioPlanning ? "Find your music, save a reusable playlist, then arrange your programmes in the weekly planner. Browsing and weekly drafts do not start broadcasting." : "Choose your channel, set its automatic music, then plan recurring programmes in Weekly planner. Saving a draft never puts it on air; preview and publish are separate steps."}
            </p>
          </div>
          <div className={styles.safetyNote}>
            <strong>Catalogue protected</strong>
            <span>Music selection and rights controls remain managed by Ruvanas.</span>
          </div>
        </div>
        <WorkspaceTabs label={radioPlanning ? "Your station workflow" : "Programming tools"} intro={radioPlanning ? "Work from left to right, or return to any step. Your unsaved work stays in its tab." : "Start with AutoDJ. Use Weekly planner when you want recurring programmes."} tabs={tabs}>
          {radioPlanning ? <div className={styles.workspace}><OnlineRadioLibraryWorkspace sandboxDraftOnly={sandboxDraftOnly} /></div> : null}
          <div className={styles.workspace}><SimplePlaylistWorkspace onlineOnly={radioPlanning} planningOnly={radioPlanning} availableProducts={enabledSubscriberProducts(entitlements).map(({ key, label }) => ({ key, label }))} /></div>
          <div className={styles.workspace}>
            <div className={styles.notice} role="note">{sandboxDraftOnly ? "Private draft planning only. A test playlist is a saved configuration, not playable audio. No plan can be published." : <>Weekly planner controls channel programmes. Location-specific music and backup settings remain in {onlineOnly ? "Backup & playback" : "Locations & backup"}.</>} {onlineRadioStation ? <a href={`/dashboard/radio/schedule/${onlineRadioStation.id}`}>Open the station programme schedule</a> : null}</div>
            <AdvancedSchedulerWorkspace onlineChannelIds={onlineChannelIds} />
          </div>
          {!sandboxDraftOnly ? <div className={styles.workspace}><ProgrammingWorkspace organisationName={context.membership.organisation.name} onlineOnly={onlineOnly} /></div> : null}
          {!sandboxDraftOnly ? <div className={styles.workspace}>
            <AutoDjExpansionWorkspace /><SmartPlaylistsWorkspace /><RadioClocksWorkspace />
          </div> : null}
          {!sandboxDraftOnly ? <div className={styles.workspace}><ExternalLiveWorkspace /><LiveFailoverWorkspace /><BrowserLiveStudioWorkspace /></div> : null}
          {!sandboxDraftOnly ? <div className={styles.workspace}><VoiceTrackingWorkspace /><AudioProcessingWorkspace /></div> : null}
          {canManage && !sandboxDraftOnly ? <div className={styles.workspace}><DjAccessWorkspace /></div> : null}
        </WorkspaceTabs>
      </section>
    </main>
  );
}

