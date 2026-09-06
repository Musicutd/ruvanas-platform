import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SkipLink from "@/app/components/SkipLink";
import RightsRoyaltyWorkspace from "./RightsRoyaltyWorkspace";
import styles from "./rights-reporting.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rights & royalty reporting | Ruvanas" };

export default async function RightsRoyaltyPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <main className={styles.page}><SkipLink /><header className={styles.header}><a href="/dashboard" className={styles.brand}>RUVANAS</a><nav><a href="/dashboard/radio">Online Radio</a><a href="/dashboard/reports">Delivery reports</a></nav></header><section className={styles.shell} id="main-content"><div className={styles.hero}><div><p className={styles.eyebrow}>MUSIC USAGE</p><h1>Rights evidence you can reconcile</h1><p>Map recordings and works for each reporting authority, review device-confirmed music usage, and create sealed exports for the territory and period you select.</p></div><div className={styles.boundary}><strong>Evidence, not a royalty invoice</strong><span>Ruvanas records completed playback. Reporting-authority acceptance, licensing and monetary royalty calculations remain subject to your agreements and the authority’s current rules.</span></div></div><RightsRoyaltyWorkspace /></section></main>;
}
