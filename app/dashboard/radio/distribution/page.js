import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SkipLink from "@/app/components/SkipLink";
import RadioDistributionWorkspace from "./RadioDistributionWorkspace";
import styles from "./distribution.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Station distribution | Ruvanas" };

export default async function RadioDistributionPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <main className={styles.page}>
    <SkipLink />
    <header className={styles.header}><a href="/dashboard" className={styles.brand}>RUVANAS</a><nav><a href="/dashboard/radio">Online Radio</a><a href="/dashboard/help">Help centre</a></nav></header>
    <section className={styles.shell} id="main-content">
      <div className={styles.hero}>
        <div><p className={styles.eyebrow}>STATION DISTRIBUTION</p><h1>Reach listeners through trusted destinations</h1><p>Prepare one governed station profile for radio directories, streaming partners, apps and voice assistants, while keeping credentials and delivery evidence under your control.</p></div>
        <div className={styles.boundary}><strong>Evidence boundary</strong><span>Queued or delivered means Ruvanas transported the request. Publication, certification and audience availability remain controlled by the receiving provider.</span></div>
      </div>
      <RadioDistributionWorkspace />
    </section>
  </main>;
}
