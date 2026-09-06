import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SkipLink from "@/app/components/SkipLink";
import SyndicationWorkspace from "./SyndicationWorkspace";
import styles from "./syndication.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Radio syndication | Ruvanas" };

export default async function RadioSyndicationPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <main className={styles.page}>
    <SkipLink />
    <header className={styles.header}><a href="/dashboard" className={styles.brand}>RUVANAS</a><nav><a href="/dashboard/radio/networks">Station networks</a><a href="/dashboard/radio">Online Radio</a></nav></header>
    <section className={styles.shell} id="main-content">
      <div className={styles.hero}>
        <div><p className={styles.eyebrow}>NETWORK SYNDICATION</p><h1>Share programmes, keep control</h1><p>Offer recorded shows or protected live relays to approved network stations. Every agreement has a named rights holder, territory and delivery window.</p></div>
        <div className={styles.boundary}><strong>Separate approval</strong><span>Network membership never grants content access by itself. The source approves each receiving station and can revoke delivery immediately.</span></div>
      </div>
      <SyndicationWorkspace />
    </section>
  </main>;
}
