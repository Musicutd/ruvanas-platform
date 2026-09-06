import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SkipLink from "@/app/components/SkipLink";
import ProgrammeDirectorWorkspace from "./ProgrammeDirectorWorkspace";
import styles from "./programme-director.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Programme Director | Ruvanas" };

export default async function ProgrammeDirectorPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <main className={styles.page}>
    <SkipLink />
    <header className={styles.header}><a href="/dashboard" className={styles.brand}>RUVANAS</a><nav><a href="/dashboard/radio">Online Radio</a><a href="/dashboard/programming">Programming</a><a href="/dashboard/help">Help centre</a></nav></header>
    <section className={styles.shell} id="main-content">
      <div className={styles.hero}>
        <div><p className={styles.eyebrow}>AI PROGRAMME DIRECTOR</p><h1>Plan confidently. Keep people in control.</h1><p>Review channel continuity and prepare an explainable programme recommendation from approved Ruvanas scheduling sources.</p></div>
        <div className={styles.boundary}><strong>Human approval boundary</strong><span>Every recommendation is a draft. It cannot alter live radio, publish a schedule, release School content or share private data with an external provider.</span></div>
      </div>
      <ProgrammeDirectorWorkspace />
    </section>
  </main>;
}
