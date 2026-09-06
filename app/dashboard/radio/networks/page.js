import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SkipLink from "@/app/components/SkipLink";
import StationNetworkWorkspace from "./StationNetworkWorkspace";
import styles from "./networks.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Station networks | Ruvanas" };

export default async function StationNetworksPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <main className={styles.page}>
    <SkipLink />
    <header className={styles.header}><a href="/dashboard" className={styles.brand}>RUVANAS</a><a href="/dashboard/radio" className={styles.back}>Back to Online Radio</a></header>
    <section className={styles.shell} id="main-content">
      <div className={styles.hero}>
        <div><p className={styles.eyebrow}>ONLINE RADIO NETWORKS</p><h1>Build a network without giving up control</h1><p>Connect independently owned stations through clear invitations and owner approval. Every station keeps its own service, audience data, audio, credentials and programming.</p></div>
        <div className={styles.boundary}><strong>Membership only</strong><span>Content sharing and syndication are separate, later agreements.</span></div>
      </div>
      <StationNetworkWorkspace />
    </section>
  </main>;
}
