import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SkipLink from "@/app/components/SkipLink";
import RadioAdvertisingWorkspace from "./RadioAdvertisingWorkspace";
import styles from "./advertising.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Radio advertising | Ruvanas" };

export default async function RadioAdvertisingPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  return <main className={styles.page}>
    <SkipLink />
    <header className={styles.header}><a href="/dashboard" className={styles.brand}>RUVANAS</a><nav><a href="/dashboard/retail-media">Retail Media</a><a href="/dashboard/radio">Online Radio</a></nav></header>
    <section className={styles.shell} id="main-content">
      <div className={styles.hero}>
        <div><p className={styles.eyebrow}>COMMERCIAL RADIO</p><h1>Advertising with clear limits</h1><p>Turn approved Retail Media bookings into governed station or channel placements. Set break limits once, pause delivery instantly, and keep scheduled volume separate from verified completed plays.</p></div>
        <div className={styles.boundary}><strong>Approval before delivery</strong><span>A campaign, inventory package, order creative and channel policy must all be approved before a commercial spot can enter the radio schedule.</span></div>
      </div>
      <RadioAdvertisingWorkspace />
    </section>
  </main>;
}
