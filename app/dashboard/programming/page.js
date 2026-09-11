import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
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
import styles from "./programming.module.css";

export const dynamic = "force-dynamic";

export default async function SubscriberProgrammingPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  const canManage = ["OWNER", "MANAGER"].includes(context.membership.role);
  const tabs = [
    { id: "schedule", label: "Schedule", description: "Now, AutoDJ and weekly plans" },
    { id: "automation", label: "Automation", description: "Playlists, clocks and advanced rules" },
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
            <p className={styles.eyebrow}>RADIO PROGRAMMING</p>
            <h1>Plan your week with confidence</h1>
            <p className={styles.intro}>
              Choose from the music modes approved for {context.membership.organisation.name},
              build a clear weekly plan and publish it to the right shop or listening area.
            </p>
          </div>
          <div className={styles.safetyNote}>
            <strong>Catalogue protected</strong>
            <span>Music selection and rights controls remain managed by Ruvanas.</span>
          </div>
        </div>
        <WorkspaceTabs label="Programming tools" intro="Open only the part of radio programming you need right now." tabs={tabs}>
          <div className={styles.workspace}><ProgrammingWorkspace organisationName={context.membership.organisation.name} /></div>
          <div className={styles.workspace}><AutoDjExpansionWorkspace /><SmartPlaylistsWorkspace /><RadioClocksWorkspace /><AdvancedSchedulerWorkspace /></div>
          <div className={styles.workspace}><ExternalLiveWorkspace /><LiveFailoverWorkspace /><BrowserLiveStudioWorkspace /></div>
          <div className={styles.workspace}><VoiceTrackingWorkspace /><AudioProcessingWorkspace /></div>
          {canManage ? <div className={styles.workspace}><DjAccessWorkspace /></div> : null}
        </WorkspaceTabs>
      </section>
    </main>
  );
}

