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
import styles from "./programming.module.css";

export const dynamic = "force-dynamic";

export default async function SubscriberProgrammingPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");

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
        <div className={styles.workspace}>
          {["OWNER", "MANAGER"].includes(context.membership.role) ? <DjAccessWorkspace /> : null}
          <ExternalLiveWorkspace />
          <LiveFailoverWorkspace />
          <BrowserLiveStudioWorkspace />
          <VoiceTrackingWorkspace />
          <SmartPlaylistsWorkspace />
          <RadioClocksWorkspace />
          <AdvancedSchedulerWorkspace />
          <ProgrammingWorkspace organisationName={context.membership.organisation.name} />
        </div>
      </section>
    </main>
  );
}

