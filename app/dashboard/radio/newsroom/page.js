import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SkipLink from "@/app/components/SkipLink";
import NewsroomWorkspace from "./NewsroomWorkspace";
import styles from "./newsroom.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsroom | Ruvanas" };

export default async function NewsroomPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <main className={styles.page}>
    <SkipLink />
    <header className={styles.header}><a href="/dashboard" className={styles.brand}>RUVANAS</a><nav><a href="/dashboard/radio">Online Radio</a><a href="/dashboard/studio">Studio</a><a href="/dashboard/help">Help centre</a></nav></header>
    <section className={styles.shell} id="main-content">
      <div className={styles.hero}>
        <div><p className={styles.eyebrow}>PROFESSIONAL NEWSROOM</p><h1>From first idea to an approved station story.</h1><p>Assign stories, preserve sources and revisions, connect production work, and keep every editorial decision accountable.</p></div>
        <div className={styles.boundary}><strong>Controlled publication</strong><span>Newsroom release does not change the live schedule or publish a public webpage. Scheduling and public distribution remain deliberate, separate actions.</span></div>
      </div>
      <NewsroomWorkspace />
    </section>
  </main>;
}
