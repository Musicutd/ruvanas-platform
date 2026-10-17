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
import styles from "./programming.module.css";

export const dynamic = "force-dynamic";

export default async function SubscriberProgrammingPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  const canManage = ["OWNER", "MANAGER"].includes(context.membership.role);
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  const onlineOnly = entitlements.onlineRadioEnabled && ![
    entitlements.retailRadioEnabled, entitlements.schoolRadioEnabled, entitlements.healthRadioEnabled,
    entitlements.faithRadioEnabled, entitlements.organisationsEnabled
  ].some(Boolean);
  const onlineRadioStation = entitlements.onlineRadioEnabled ? await prisma.station.findFirst({
    where: { organisationId: context.membership.organisationId, productFamily: "ONLINE" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" }
  }) : null;
  const tabs = [
    { id: "simple", label: "AutoDJ & playlists", description: "Choose a channel, check its plan and save music settings" },
    { id: "planner", label: "Weekly planner", description: "Prepare a programme, preview seven days, then publish" },
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
            <p className={styles.eyebrow}>AUTODJ & SCHEDULE</p>
            <h1>Music made easier to plan</h1>
            <p className={styles.intro}>
              Choose your channel, set its automatic music, then plan recurring programmes in Weekly planner. Saving a draft never puts it on air; preview and publish are separate steps.
            </p>
          </div>
          <div className={styles.safetyNote}>
            <strong>Catalogue protected</strong>
            <span>Music selection and rights controls remain managed by Ruvanas.</span>
          </div>
        </div>
        <WorkspaceTabs label="Programming tools" intro="Start with AutoDJ. Use Weekly planner when you want recurring programmes." tabs={tabs}>
          <div className={styles.workspace}><SimplePlaylistWorkspace availableProducts={enabledSubscriberProducts(entitlements).map(({ key, label }) => ({ key, label }))} /></div>
          <div className={styles.workspace}>
            <div className={styles.notice} role="note">Weekly planner controls channel programmes. Location-specific music and backup settings remain in {onlineOnly ? "Backup & playback" : "Locations & backup"}. {onlineRadioStation ? <a href={`/dashboard/radio/schedule/${onlineRadioStation.id}`}>Open the station programme schedule</a> : null}</div>
            <AdvancedSchedulerWorkspace />
          </div>
          <div className={styles.workspace}><ProgrammingWorkspace organisationName={context.membership.organisation.name} onlineOnly={onlineOnly} /></div>
          <div className={styles.workspace}>
            <AutoDjExpansionWorkspace /><SmartPlaylistsWorkspace /><RadioClocksWorkspace />
          </div>
          <div className={styles.workspace}><ExternalLiveWorkspace /><LiveFailoverWorkspace /><BrowserLiveStudioWorkspace /></div>
          <div className={styles.workspace}><VoiceTrackingWorkspace /><AudioProcessingWorkspace /></div>
          {canManage ? <div className={styles.workspace}><DjAccessWorkspace /></div> : null}
        </WorkspaceTabs>
      </section>
    </main>
  );
}

